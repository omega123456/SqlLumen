import { useTableDataStore, isSameRowKey } from '../../../stores/table-data-store'
import { FALLBACK_ROW_LIMIT } from '../../../stores/query-store'
import type {
  ForeignKeyColumnInfo,
  PrimaryKeyInfo,
  RowEditState,
  TableDataColumnMeta,
  TableDataTabState,
} from '../../../types/schema'

const NOT_FOUND = -1

export function getRowKeyFromArray(
  row: unknown[],
  columns: TableDataColumnMeta[],
  primaryKeyColumns: string[]
): Record<string, unknown> {
  const key: Record<string, unknown> = {}
  for (const primaryKeyColumn of primaryKeyColumns) {
    const index = columns.findIndex((column) => column.name === primaryKeyColumn)
    if (index !== NOT_FOUND) {
      key[primaryKeyColumn] = row[index]
    }
  }
  return key
}

export type RowKey = Record<string, unknown>

const EMPTY_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_ROWS: unknown[][] = []
const EMPTY_KEY_COLUMNS: string[] = []
const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []

export interface FormTabView {
  connectionId: string
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  currentPage: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  primaryKeyColumns: string[]
  editState: RowEditState | null
  selectedRowKey: RowKey | null
  isLoading: boolean
  foreignKeys: ForeignKeyColumnInfo[]
}

const EMPTY_FORM_TAB_VIEW: FormTabView = {
  connectionId: '',
  columns: EMPTY_COLUMNS,
  rows: EMPTY_ROWS,
  currentPage: 1,
  pageSize: FALLBACK_ROW_LIMIT,
  primaryKey: null,
  primaryKeyColumns: EMPTY_KEY_COLUMNS,
  editState: null,
  selectedRowKey: null,
  isLoading: false,
  foreignKeys: EMPTY_FOREIGN_KEYS,
}

export function formTabView(tabState: TableDataTabState | undefined): FormTabView {
  if (!tabState) return EMPTY_FORM_TAB_VIEW
  return {
    connectionId: tabState.connectionId,
    columns: tabState.columns,
    rows: tabState.rows,
    currentPage: tabState.currentPage,
    pageSize: tabState.pageSize,
    primaryKey: tabState.primaryKey,
    primaryKeyColumns: tabState.primaryKey?.keyColumns ?? EMPTY_KEY_COLUMNS,
    editState: tabState.editState,
    selectedRowKey: tabState.selectedRowKey,
    isLoading: tabState.isLoading,
    foreignKeys: tabState.foreignKeys ?? EMPTY_FOREIGN_KEYS,
  }
}

interface SelectedRowLookup {
  selectedRowKey: RowKey | null
  rows: unknown[][]
  columns: TableDataColumnMeta[]
  primaryKeyColumns: string[]
}

export function findSelectedLocalIndex(lookup: SelectedRowLookup): number {
  const { selectedRowKey, rows } = lookup
  if (!selectedRowKey) return 0
  if (rows.length === 0) return 0
  if ('__tempId' in selectedRowKey) {
    return rows.length - 1
  }
  const index = rows.findIndex((row) => {
    const key = getRowKeyFromArray(row, lookup.columns, lookup.primaryKeyColumns)
    return isSameRowKey(key, selectedRowKey)
  })
  return Math.max(index, 0)
}

export function buildCurrentRowData(
  currentRow: unknown[],
  columns: TableDataColumnMeta[],
  activeEditState: RowEditState | null
): Record<string, unknown> {
  const rowData: Record<string, unknown> = {}
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    rowData[columns[columnIndex].name] = currentRow[columnIndex] ?? null
  }

  if (!activeEditState) return rowData

  rowData.__editingRowKey = activeEditState.rowKey
  for (const [columnName, value] of Object.entries(activeEditState.currentValues)) {
    rowData[columnName] = value
  }
  return rowData
}

interface FormEditability {
  isConnectionReadOnly: boolean
  hasPrimaryKey: boolean
  isView: boolean | undefined
}

export function canEditFormRows(editability: FormEditability): boolean {
  if (editability.isConnectionReadOnly || editability.isView) return false
  return editability.hasPrimaryKey
}

export function isAtFirstRecord(currentPage: number, localIndex: number): boolean {
  return currentPage === 1 && localIndex === 0
}

type StoreRowPicker = (rows: unknown[][]) => unknown[] | undefined

function selectStoreRow(tabId: string, primaryKeyColumns: string[], pickRow: StoreRowPicker): void {
  const updatedState = useTableDataStore.getState().tabs[tabId]
  if (!updatedState) return
  const targetRow = pickRow(updatedState.rows)
  if (!targetRow) return
  const newKey = getRowKeyFromArray(targetRow, updatedState.columns, primaryKeyColumns)
  useTableDataStore.getState().setSelectedRow(tabId, newKey)
}

interface FormRowPosition {
  localIndex: number
  rowCount: number
  currentPage: number
  pageSize: number
}

interface RelativeRowNavigation {
  tabId: string
  direction: -1 | 1
  position: FormRowPosition
  primaryKeyColumns: string[]
  fetchPage: (tabId: string, page: number) => Promise<void>
}

const pickFirstRow: StoreRowPicker = (rows) => rows[0]
const pickLastRow: StoreRowPicker = (rows) => rows[rows.length - 1]

export async function navigateToRelativeRow(navigation: RelativeRowNavigation): Promise<void> {
  const { tabId, direction, position, primaryKeyColumns } = navigation
  const isForwardCrossPage = direction > 0 && position.localIndex === position.rowCount - 1
  const isBackwardCrossPage = direction < 0 && position.localIndex === 0 && position.currentPage > 1

  if (isForwardCrossPage) {
    await navigation.fetchPage(tabId, position.currentPage + 1)
    selectStoreRow(tabId, primaryKeyColumns, pickFirstRow)
    return
  }

  if (isBackwardCrossPage) {
    await navigation.fetchPage(tabId, position.currentPage - 1)
    selectStoreRow(tabId, primaryKeyColumns, pickLastRow)
    return
  }

  const absoluteIndex = (position.currentPage - 1) * position.pageSize + position.localIndex
  const newAbsoluteIndex = absoluteIndex + direction
  const newLocalIndex =
    ((newAbsoluteIndex % position.pageSize) + position.pageSize) % position.pageSize
  selectStoreRow(tabId, primaryKeyColumns, (rows) => rows[Math.min(newLocalIndex, rows.length - 1)])
}
