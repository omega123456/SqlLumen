/**
 * Test harness for the shared data views (`DataGridView`, `DataFormView`,
 * `DataTextView`). The views read everything from the store through a
 * surface ref, so a test describes one query result (rows, edit target,
 * selection) as a fixture; the harness writes it into the query store, seeds
 * the page cache with the rows (identity view, base indices 0..n-1) and hands
 * back the route source the view renders from.
 */
import { act } from '@testing-library/react'
import { querySurfaceRef, useQueryStore } from '../../stores/query-store'
import { buildBoundColumnIndexMap } from '../../lib/query-edit-utils'
import type { ViewRange } from '../../lib/result-window-cache'
import type {
  ColumnMeta,
  ForeignKeyColumnInfo,
  QueryTableEditInfo,
  ResultViewSort,
  RowEditState,
  SelectedCellInfo,
  TableDataColumnMeta,
} from '../../types/schema'
import type { ViewMode } from '../../types/shared-data-view'
import type { DataViewSource } from '../../components/shared/data-view/data-view-source'
import { queryDataViewSource } from '../../components/query-editor/result-panel/query-data-view-source'
import { resultWith } from './query-store-fixtures'
import { makeTabState, seedResultRows } from './query-test-utils'

export const DATA_VIEW_TAB_ID = 'tab-1'
export const DATA_VIEW_QUERY_ID = 'q-grid'
export const DATA_VIEW_CONNECTION_ID = 'conn-1'

export interface DataViewFixture {
  columns: ColumnMeta[]
  rows: unknown[][]
  viewRowCount?: number
  mode?: ViewMode
  draftRow?: unknown[] | null
  editMode?: string | null
  editableColumnMap?: Map<number, boolean>
  editState?: RowEditState | null
  editingRowIndex?: number | null
  editingBaseIndex?: number | null
  editTableColumns?: TableDataColumnMeta[]
  editForeignKeys?: ForeignKeyColumnInfo[]
  editColumnBindings?: Map<number, string>
  selectedRowIndex?: number | null
  selectedCell?: SelectedCellInfo | null
  sort?: ResultViewSort | null
  checkedRanges?: ViewRange[]
  editDatabase?: string
  editTable?: string
  truncated?: boolean
  isActive?: boolean
}

function editTableOf(fixture: DataViewFixture, editMode: string): QueryTableEditInfo {
  const tableColumns = fixture.editTableColumns ?? []
  const keyColumns = tableColumns
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name)
  return {
    database: fixture.editDatabase ?? 'db',
    table: fixture.editTable ?? editMode,
    columns: tableColumns,
    primaryKey: { keyColumns: keyColumns, hasAutoIncrement: false, isUniqueKeyFallback: false },
    foreignKeys: [],
  }
}

function editTablesOf(fixture: DataViewFixture): Record<string, QueryTableEditInfo> {
  const editMode = fixture.editMode ?? null
  if (editMode === null) return {}
  return { [editMode]: editTableOf(fixture, editMode) }
}

function defaultEditingBaseIndex(fixture: DataViewFixture): number | null {
  if (fixture.editingBaseIndex !== undefined) return fixture.editingBaseIndex
  const editingRowIndex = fixture.editingRowIndex ?? null
  if (editingRowIndex === null) return null
  return editingRowIndex < fixture.rows.length ? editingRowIndex : null
}

function fixtureResult(fixture: DataViewFixture) {
  const bindings = fixture.editColumnBindings ?? new Map<number, string>()
  const viewRowCount = fixture.viewRowCount ?? fixture.rows.length
  return resultWith({
    resultStatus: 'success',
    truncated: fixture.truncated ?? false,
    view: {
      mode: fixture.mode ?? 'grid',
      slot: {
        columns: fixture.columns,
        queryId: DATA_VIEW_QUERY_ID,
        viewVersion: 1,
        viewRowCount: viewRowCount,
        totalRows: viewRowCount,
        connectionId: DATA_VIEW_CONNECTION_ID,
      },
      selection: {
        rowIndex: fixture.selectedRowIndex ?? null,
        cell: fixture.selectedCell ?? null,
      },
      checked: { ranges: fixture.checkedRanges ?? [], viewVersion: 1 },
      spec: { sort: fixture.sort ?? null },
      edit: {
        state: fixture.editState ?? null,
        rowIndex: fixture.editingRowIndex ?? null,
        baseIndex: defaultEditingBaseIndex(fixture),
        draftRow: fixture.draftRow ?? null,
      },
      editTarget: {
        tableName: fixture.editMode ?? null,
        tables: editTablesOf(fixture),
        foreignKeys: fixture.editForeignKeys ?? [],
        editableColumns: fixture.editableColumnMap ?? new Map(),
        bindings: bindings,
        boundIndexByName: buildBoundColumnIndexMap(bindings),
      },
    },
  })
}

export function seedDataView(fixture: DataViewFixture): DataViewSource {
  const result = fixtureResult(fixture)
  const tab = makeTabState({
    tabStatus: 'success',
    connectionId: DATA_VIEW_CONNECTION_ID,
  })
  act(() => {
    useQueryStore.setState((state) => ({
      tabs: { ...state.tabs, [DATA_VIEW_TAB_ID]: { ...tab, results: [result] } },
    }))
  })
  seedResultRows(DATA_VIEW_TAB_ID, 0, result, fixture.rows, DATA_VIEW_CONNECTION_ID)
  return queryDataViewSource({
    ref: querySurfaceRef(DATA_VIEW_TAB_ID, 0),
    isActive: fixture.isActive ?? true,
    isTruncated: fixture.truncated ?? false,
    canEdit: fixture.editMode != null,
  })
}

export function dataViewResult() {
  return useQueryStore.getState().tabs[DATA_VIEW_TAB_ID].results[0].view
}
