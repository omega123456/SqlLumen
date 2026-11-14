import type { TableDataColumnMeta, TableDataTabState, RowEditState } from '../../types/schema'

export function isSameRowKey(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null
): boolean {
  const isEitherKeyMissing = left === null || right === null
  if (isEitherKeyMissing) return left === right
  const aKeys = Object.keys(left).sort()
  const bKeys = Object.keys(right).sort()
  if (aKeys.length !== bKeys.length) return false
  const isSameEntryAt = (key: string, index: number): boolean =>
    key === bKeys[index] && isSameJsonValue(left[key], right[key])
  return aKeys.every(isSameEntryAt)
}

function isSameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function findRowIndexByKey(
  rows: unknown[][],
  columns: TableDataColumnMeta[],
  rowKey: Record<string, unknown>
): number {
  if ('__tempId' in rowKey) return -1

  return rows.findIndex((row) => {
    for (const [keyColumn, keyValue] of Object.entries(rowKey)) {
      const columnIndex = columns.findIndex((column) => column.name === keyColumn)
      if (columnIndex === -1) return false
      if (!isSameJsonValue(row[columnIndex], keyValue)) return false
    }
    return true
  })
}

export function getRowKeyFromData(
  rowData: Record<string, unknown>,
  primaryKeyColumns: string[],
  options: { includeRowIndexFallback?: boolean } = {}
): Record<string, unknown> {
  if ('__tempId' in rowData) {
    return { __tempId: rowData.__tempId }
  }

  const editingRowKey = rowData.__editingRowKey
  const hasEditingRowKey = Boolean(editingRowKey) && typeof editingRowKey === 'object'
  if (hasEditingRowKey) {
    return editingRowKey as Record<string, unknown>
  }

  const key: Record<string, unknown> = {}
  for (const column of primaryKeyColumns) {
    key[column] = rowData[column]
  }
  const shouldFallBackToRowIndex =
    options.includeRowIndexFallback === true &&
    primaryKeyColumns.length === 0 &&
    rowData.__rowIndex != null
  if (shouldFallBackToRowIndex) {
    key.__rowIndex = rowData.__rowIndex
  }
  return key
}

export function isEditingRowKey(
  editState: RowEditState | null | undefined,
  rowKey: Record<string, unknown> | null
): editState is RowEditState {
  if (!editState) return false
  return isSameRowKey(editState.rowKey, rowKey)
}

export function buildPersistedRowKeyFromInsertedData(
  insertedData: [string, unknown][],
  primaryKeyColumns: string[]
): Record<string, unknown> | null {
  if (primaryKeyColumns.length === 0) return null

  const returnedMap = Object.fromEntries(insertedData)
  const nextRowKey: Record<string, unknown> = {}
  for (const keyColumn of primaryKeyColumns) {
    if (!(keyColumn in returnedMap)) {
      return null
    }
    nextRowKey[keyColumn] = returnedMap[keyColumn]
  }

  return nextRowKey
}

export type RowKey = Record<string, unknown>

export function isDraftRowKey(rowKey: RowKey): boolean {
  return '__tempId' in rowKey
}

export function rowKeyAfterCellChange(
  primaryKeyColumns: string[],
  rowKey: RowKey,
  change: { column: string; value: unknown }
): RowKey {
  if (!primaryKeyColumns.includes(change.column)) return rowKey
  if (isDraftRowKey(rowKey)) return rowKey
  return { ...rowKey, [change.column]: change.value }
}

export interface RowKeyRename {
  previous: RowKey
  next: RowKey
}

export function renameEditStateRowKey(
  editState: RowEditState | null,
  rename: RowKeyRename
): RowEditState | null {
  if (editState === null) return editState
  if (!isSameRowKey(editState.rowKey, rename.previous)) return editState
  return { ...editState, rowKey: rename.next }
}

export function renameSelectedRowKey(
  selectedRowKey: RowKey | null,
  rename: RowKeyRename
): RowKey | null {
  if (!selectedRowKey) return selectedRowKey
  if (!isSameRowKey(selectedRowKey, rename.previous)) return selectedRowKey
  return rename.next
}

export function isSelectedDraftRow(tab: TableDataTabState, editState: RowEditState): boolean {
  const selectedRowKey = tab.selectedRowKey
  if (selectedRowKey === null) return false
  if (!isDraftRowKey(selectedRowKey)) return false
  return editState.tempId === selectedRowKey.__tempId
}

export function restoredSelectedRowKey(
  tab: TableDataTabState,
  editState: RowEditState
): RowKey | null {
  const isEditedRowSelected =
    tab.selectedRowKey !== null && isSameRowKey(tab.selectedRowKey, editState.rowKey)
  if (!isEditedRowSelected) {
    return tab.selectedRowKey
  }
  return Object.fromEntries(
    Object.keys(editState.rowKey).map((key) => [key, editState.originalValues[key]])
  )
}
