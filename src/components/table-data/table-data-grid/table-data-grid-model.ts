import {
  useTableDataStore,
  isEditingRowKey,
  isSameRowKey,
  findRowIndexByKey as findStoreRowIndexByKey,
  getRowKeyFromData,
} from '../../../stores/table-data-store'
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
  getAutoSizedColumnWidth,
} from '../../../lib/grid-column-style'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
  CellClickGuardArgs,
  CellClickGuardResult,
} from '../../../types/shared-data-view'
import type { TableDataColumnMeta } from '../../../types/schema'
import { isObjectRecord } from '../../../lib/value-checks'

const EDITING_ROW_CLASS = 'grid-editing-row'
const NEW_ROW_CLASS = 'grid-new-row'
export const SELECTED_ROW_CLASS = 'grid-row-precision-selected'
const NOT_FOUND = -1

export type TableDataRow = Record<string, unknown>

export function getRowKey(
  data: Record<string, unknown>,
  primaryKeyColumns: string[]
): Record<string, unknown> {
  return getRowKeyFromData(data, primaryKeyColumns, { includeRowIndexFallback: true })
}

export function findRowIndexByKey(
  rows: Record<string, unknown>[],
  targetKey: Record<string, unknown>,
  primaryKeyColumns: string[]
): number {
  return rows.findIndex((row) => isSameRowKey(getRowKey(row, primaryKeyColumns), targetKey))
}

export type RowKey = Record<string, unknown>
export type TableDataTabState = NonNullable<
  ReturnType<typeof useTableDataStore.getState>['tabs'][string]
>
export type TableEditState = TableDataTabState['editState']

export interface TableDataGridView {
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  primaryKey: TableDataTabState['primaryKey']
  editState: TableEditState
  sort: TableDataTabState['sort']
  selectedRowKey: RowKey | null
  selectedCell: TableDataTabState['selectedCell']
  foreignKeys: NonNullable<TableDataTabState['foreignKeys']>
  columnWidths: Record<string, number>
  checkedRowCount: number
  scrollRow: number
  scrollCol: number
}

const EMPTY_GRID_VIEW: TableDataGridView = {
  columns: [],
  rows: [],
  primaryKey: null,
  editState: null,
  sort: null,
  selectedRowKey: null,
  selectedCell: null,
  foreignKeys: [],
  columnWidths: {},
  checkedRowCount: 0,
  scrollRow: 0,
  scrollCol: 0,
}

export function readGridTabView(tabState: TableDataTabState | undefined): TableDataGridView {
  if (!tabState) return EMPTY_GRID_VIEW
  return {
    columns: tabState.columns,
    rows: tabState.rows,
    primaryKey: tabState.primaryKey,
    editState: tabState.editState,
    sort: tabState.sort,
    selectedRowKey: tabState.selectedRowKey,
    selectedCell: tabState.selectedCell,
    foreignKeys: tabState.foreignKeys ?? EMPTY_GRID_VIEW.foreignKeys,
    columnWidths: tabState.columnWidths ?? EMPTY_GRID_VIEW.columnWidths,
    checkedRowCount: tabState.checkedRowKeys?.length ?? 0,
    scrollRow: tabState.scrollRow,
    scrollCol: tabState.scrollCol,
  }
}

export function draftTempIdOf(rowKey: RowKey | null): unknown {
  if (!rowKey) return null
  if (!('__tempId' in rowKey)) return null
  return rowKey.__tempId
}

export function editingRowClasses(editState: TableEditState, rowKey: RowKey): string[] {
  if (!isEditingRowKey(editState, rowKey)) return []
  if (editState.isNewRow) return [EDITING_ROW_CLASS, NEW_ROW_CLASS]
  return [EDITING_ROW_CLASS]
}

function isDraftRowIndex(editState: TableEditState, rowIndex: number, rowCount: number): boolean {
  const hasDraftTempId = editState?.isNewRow === true && Boolean(editState.tempId)
  return hasDraftTempId && rowIndex === rowCount - 1
}

interface TableDataRowSource {
  rows: unknown[][]
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
  editState: TableEditState
}

export function buildTableDataRow(source: TableDataRowSource, rowIndex: number): TableDataRow {
  const { rows, columns, editState } = source
  const row = rows[rowIndex]
  const object: TableDataRow = { __rowIndex: rowIndex }
  columns.forEach((column, columnIndex) => {
    object[column.name] = row[columnIndex] ?? null
  })
  if (isDraftRowIndex(editState, rowIndex, rows.length)) {
    object.__tempId = editState?.tempId
  }
  if (!editState) return object
  const rowKey = getRowKey(object, source.primaryKeyColumns)
  if (!isSameRowKey(rowKey, editState.rowKey)) return object
  object.__editingRowKey = editState.rowKey
  for (const [columnName, value] of Object.entries(editState.currentValues)) {
    object[columnName] = value
  }
  return object
}

export function resolveRestoreRowIndex(
  currentState: TableDataTabState | undefined,
  fallbackRowIndex: number
): number {
  const editState = currentState?.editState
  if (!currentState) return fallbackRowIndex
  if (!editState) return fallbackRowIndex
  if ('__tempId' in editState.rowKey) return Math.max(0, currentState.rows.length - 1)
  const matchedRowIndex = findStoreRowIndexByKey(
    currentState.rows,
    currentState.columns,
    editState.rowKey
  )
  return matchedRowIndex >= 0 ? matchedRowIndex : fallbackRowIndex
}

export function gridSortProps(sort: TableDataTabState['sort']) {
  if (!sort) return { sortColumn: null, sortDirection: null }
  return {
    sortColumn: sort.column,
    sortDirection: sort.direction.toUpperCase() as 'ASC' | 'DESC',
  }
}

export function draftScrollRowIndex(editState: TableEditState, rowCount: number): number | null {
  return editState?.isNewRow ? rowCount - 1 : null
}

export function isPointerOrUnknownSource(source: CellClickGuardArgs['source']): boolean {
  return !source || source === 'grid-pointer'
}

export interface CellSwitchTarget {
  targetRowKey: RowKey
  fallbackRowIndex: number
  targetColumnIndex: number
  enableEditorOnRestore: boolean
}

export type CellSwitchGuardOutcome =
  { passed: true } | { passed: false; result: CellClickGuardResult }

export function rowIdentityKey(row: TableDataRow, primaryKeyColumns: string[]): string {
  if (row.__tempId) return String(row.__tempId)
  const editingRowKey = row.__editingRowKey
  if (isObjectRecord(editingRowKey)) return JSON.stringify(Object.values(editingRowKey))
  if (primaryKeyColumns.length > 0) {
    return JSON.stringify(primaryKeyColumns.map((columnName) => row[columnName]))
  }
  return String(row.__rowIndex)
}

export function currentValuesFromRow(
  columns: TableDataColumnMeta[],
  row: TableDataRow
): Record<string, unknown> {
  const currentValues: Record<string, unknown> = {}
  columns.forEach((column) => {
    currentValues[column.name] = row[column.name]
  })
  return currentValues
}

export function checkedRowKeyOf(row: TableDataRow, primaryKeyColumns: string[]): RowKey {
  if (row.__tempId) return { __tempId: row.__tempId }
  return getRowKey(row, primaryKeyColumns)
}

export function toSharedTableEditState(editState: TableEditState): SharedRowEditState | null {
  if (!editState) return null
  return {
    rowKey: JSON.stringify(editState.rowKey),
    currentValues: editState.currentValues,
    originalValues: editState.originalValues,
  }
}

interface SelectedCellLookup {
  rowData: TableDataRow[]
  descriptorColumns: GridColumnDescriptor[]
  primaryKeyColumns: string[]
  selectedRowKey: RowKey | null
  selectedCell: TableDataTabState['selectedCell']
}

export function selectedCellPositionOf(lookup: SelectedCellLookup) {
  const { selectedCell, selectedRowKey } = lookup
  if (!selectedCell) return null
  const rowIndex = selectedRowKey
    ? findRowIndexByKey(lookup.rowData, selectedRowKey, lookup.primaryKeyColumns)
    : NOT_FOUND
  const columnIndex = lookup.descriptorColumns.findIndex(
    (column) => column.key === selectedCell.columnKey
  )
  const isCellVisible = rowIndex >= 0 && columnIndex >= 0
  return isCellVisible ? { rowIdx: rowIndex, idx: columnIndex } : null
}

interface ColumnLookup {
  metaByName: Map<string, TableDataColumnMeta>
  indexByName: Map<string, number>
}

export function buildColumnLookup(columns: TableDataColumnMeta[]): ColumnLookup {
  return {
    metaByName: new Map(columns.map((column) => [column.name, column])),
    indexByName: new Map(columns.map((column, columnIndex) => [column.name, columnIndex])),
  }
}

function sampleColumnValues(rows: unknown[][], columnIndex: number): unknown[][] {
  const sampleCount = Math.min(rows.length, AUTO_SIZE_SAMPLE_LIMIT)
  const columnRows: unknown[][] = new Array(sampleCount)
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    columnRows[sampleIndex] = [rows[sampleIndex][columnIndex]]
  }
  return columnRows
}

function headerIconWidthFor(column: GridColumnDescriptor): number {
  const showLock = !column.editable && column.blobViewerEditable !== true
  const showsHeaderIcon = Boolean(column.foreignKey) || showLock
  return showsHeaderIcon ? HEADER_ICON_WIDTH_PX : 0
}

export function computeTableColumnWidth(
  lookup: ColumnLookup,
  rows: unknown[][],
  column: GridColumnDescriptor
): number {
  const meta = lookup.metaByName.get(column.key)
  const columnIndex = lookup.indexByName.get(column.key)
  if (!meta) return DEFAULT_COLUMN_WIDTH_PX
  if (columnIndex == null) return DEFAULT_COLUMN_WIDTH_PX
  return getAutoSizedColumnWidth({
    column: meta,
    columnIndex: 0,
    rows: sampleColumnValues(rows, columnIndex),
    displayName: column.key,
    headerIconWidthPx: headerIconWidthFor(column),
  })
}
