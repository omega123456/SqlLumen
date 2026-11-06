/**
 * Windowed query results in the store:
 * - every re-run path passes the current view spec, so the first window comes
 *   back already sorted and filtered in one execute call (D18);
 * - a saved edit under a sort and filter targets the row's base index and
 *   patches the page cache (the view version doesn't change).
 */
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  DEFAULT_RESULT_STATE,
  useQueryStore,
  type SingleResultState,
} from '../../stores/query-store'
import { seedResultWindow } from '../../lib/result-window-cache'
import type { ColumnMeta, FilterCondition, QueryTableEditInfo } from '../../types/schema'
import { rowsOf, windowedItem, windowedResponse, withRows } from '../helpers/query-test-utils'

const TAB = 'tab-win'
const CONN = 'conn-1'

const COLUMNS: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
]

const FILTERS: FilterCondition[] = [
  { column: 'name', operator: 'LIKE', value: '%a%' },
  // A column the re-run result no longer has: Rust drops it silently.
  { column: 'gone', operator: '==', value: '1' },
]

function setTab(results: Array<Partial<SingleResultState>>, content = 'SELECT id, name FROM t') {
  act(() => {
    useQueryStore.setState({
      tabs: {
        [TAB]: {
          content,
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: CONN,
          results: results.map((result) => ({ ...DEFAULT_RESULT_STATE, ...result })),
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'result' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
  })
}

const SORTED_FILTERED: Partial<SingleResultState> = {
  resultStatus: 'success',
  queryId: 'q-old',
  columns: COLUMNS,
  totalRows: 3,
  viewVersion: 4,
  latestKnownViewVersion: 4,
  lastExecutedSql: 'SELECT id, name FROM t',
  reExecutable: true,
  sortColumn: 'name',
  sortDirection: 'desc',
  filterModel: FILTERS,
  ...withRows([
    [2, 'Dana'],
    [1, 'Ada'],
  ]),
}

const EXPECTED_SPEC = { sort: { column: 'name', direction: 'desc' }, filters: FILTERS }

/** A re-run response already sorted and filtered by Rust (identity base indices differ). */
const RERUN_WINDOW_ROWS = [
  [2, 'Dana'],
  [1, 'Ada'],
]

beforeEach(() => {
  ipc.override('analyze_query_for_edit', () => [])
})

describe('re-runs keep the view spec (D18)', () => {
  it('a row-limit change re-executes with the view spec and paints the returned window', async () => {
    setTab([SORTED_FILTERED])
    ipc.override('execute_query', () =>
      windowedResponse({
        queryId: 'q-new',
        columns: COLUMNS,
        totalRows: 3,
        viewRowCount: 2,
        viewVersion: 1,
        firstWindow: { offset: 0, rows: RERUN_WINDOW_ROWS, baseIndices: [1, 0] },
      })
    )

    await act(async () => {
      await useQueryStore.getState().changeRowLimit(CONN, TAB, 50)
    })

    expect(ipc.calls('execute_query')).toHaveLength(1)
    expect(ipc.calls('execute_query')[0]).toMatchObject({ rowLimit: 50, viewSpec: EXPECTED_SPEC })
    expect(ipc.calls('set_result_view')).toHaveLength(0)
    const result = useQueryStore.getState().tabs[TAB]!.results[0]
    expect(result.queryId).toBe('q-new')
    expect(result.sortColumn).toBe('name')
    // The condition on the missing column is dropped without an error.
    expect(result.filterModel).toEqual([FILTERS[0]])
    expect(result.viewRowCount).toBe(2)
    expect(rowsOf(TAB)).toEqual(RERUN_WINDOW_ROWS)
  })

  it('a multi-result re-execute passes the view spec to reexecute_single_result', async () => {
    setTab([
      SORTED_FILTERED,
      { ...SORTED_FILTERED, queryId: 'q-other', sortColumn: null, filterModel: [] },
    ])
    ipc.override('reexecute_single_result', () =>
      windowedItem({
        queryId: 'q-new',
        columns: COLUMNS,
        totalRows: 3,
        viewRowCount: 2,
        firstWindow: { offset: 0, rows: RERUN_WINDOW_ROWS, baseIndices: [1, 0] },
      })
    )

    await act(async () => {
      await useQueryStore.getState().changeRowLimit(CONN, TAB, 25)
    })

    expect(ipc.calls('reexecute_single_result')[0]).toMatchObject({
      resultIndex: 0,
      rowLimit: 25,
      viewSpec: EXPECTED_SPEC,
    })
    expect(ipc.calls('set_result_view')).toHaveLength(0)
    expect(rowsOf(TAB, 0)).toEqual(RERUN_WINDOW_ROWS)
  })

  it('omits the view spec when the result has no sort or filter', async () => {
    setTab([{ ...SORTED_FILTERED, sortColumn: null, sortDirection: null, filterModel: [] }])
    ipc.override('execute_query', () => windowedResponse({ columns: COLUMNS }))

    await act(async () => {
      await useQueryStore.getState().changeRowLimit(CONN, TAB, 10)
    })

    expect('viewSpec' in (ipc.calls('execute_query')[0] as Record<string, unknown>)).toBe(false)
  })

  it('restoring an expired single result re-runs once with the view spec', async () => {
    setTab([{ ...SORTED_FILTERED, isExpired: true }])
    ipc.override('execute_query', () =>
      windowedResponse({
        queryId: 'q-restored',
        columns: COLUMNS,
        totalRows: 3,
        viewRowCount: 2,
        firstWindow: { offset: 0, rows: RERUN_WINDOW_ROWS, baseIndices: [1, 0] },
      })
    )

    await act(async () => {
      await useQueryStore.getState().retryExpiredResult(TAB)
    })

    expect(ipc.calls('execute_query')).toHaveLength(1)
    expect(ipc.calls('execute_query')[0]).toMatchObject({ viewSpec: EXPECTED_SPEC })
    const result = useQueryStore.getState().tabs[TAB]!.results[0]
    expect(result.isExpired).toBe(false)
    expect(result.sortColumn).toBe('name')
    expect(rowsOf(TAB)).toEqual(RERUN_WINDOW_ROWS)
  })

  it('the re-run after a clone insert passes the view spec', async () => {
    const tableInfo: QueryTableEditInfo = {
      database: 'db',
      table: 't',
      columns: [
        {
          name: 'id',
          dataType: 'INT',
          isBooleanAlias: false,
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: true,
        },
        {
          name: 'name',
          dataType: 'VARCHAR',
          isBooleanAlias: false,
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isAutoIncrement: false,
        },
      ],
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      foreignKeys: [],
    }
    setTab([
      {
        ...SORTED_FILTERED,
        editMode: 'db.t',
        editConnectionId: CONN,
        editTableMetadata: { 'db.t': tableInfo },
        editableColumnMap: new Map([
          [0, false],
          [1, true],
        ]),
        editColumnBindings: new Map([
          [0, 'id'],
          [1, 'name'],
        ]),
        editBoundColumnIndexMap: new Map([
          ['id', 0],
          ['name', 1],
        ]),
        selectedRowIndex: 0,
      },
    ])
    ipc.override('insert_table_row', () => [['id', 9]])
    ipc.override('execute_query', () =>
      windowedResponse({ queryId: 'q-after-insert', columns: COLUMNS, totalRows: 4 })
    )

    act(() => {
      useQueryStore.getState().cloneSelectedRow(TAB)
    })
    await act(async () => {
      await useQueryStore.getState().saveCurrentRow(TAB)
    })

    expect(ipc.calls('insert_table_row')).toHaveLength(1)
    expect(ipc.calls('execute_query')[0]).toMatchObject({ viewSpec: EXPECTED_SPEC })
    expect(useQueryStore.getState().tabs[TAB]!.results[0].queryId).toBe('q-after-insert')
  })
})

describe('edits under a sort and filter', () => {
  it('saves the edited row by base index and patches the page cache in place', async () => {
    const tableInfo: QueryTableEditInfo = {
      database: 'db',
      table: 't',
      columns: [],
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      foreignKeys: [],
    }
    setTab([
      {
        ...SORTED_FILTERED,
        editMode: 'db.t',
        editConnectionId: CONN,
        editTableMetadata: { 'db.t': tableInfo },
        editableColumnMap: new Map([[1, true]]),
        editColumnBindings: new Map([
          [0, 'id'],
          [1, 'name'],
        ]),
        editBoundColumnIndexMap: new Map([
          ['id', 0],
          ['name', 1],
        ]),
      },
    ])
    // The sorted, filtered view: position 0 is base row 2, position 1 is base row 0.
    seedResultWindow({
      connectionId: CONN,
      tabId: TAB,
      resultIndex: 0,
      queryId: 'q-old',
      viewVersion: 4,
      viewRowCount: 2,
      columns: COLUMNS,
      window: {
        offset: 0,
        rows: [
          [3, 'Dana'],
          [1, 'Ada'],
        ],
        baseIndices: [2, 0],
      },
    })
    ipc.override('update_table_row', () => undefined)
    ipc.override('update_result_cell', () => undefined)

    act(() => {
      useQueryStore.getState().startEditingRow(TAB, 1)
      useQueryStore.getState().syncCellValue(TAB, 1, 'Zed')
    })
    expect(useQueryStore.getState().tabs[TAB]!.results[0].editingBaseIndex).toBe(0)

    await act(async () => {
      expect(await useQueryStore.getState().saveCurrentRow(TAB)).toBe(true)
    })

    expect(ipc.calls('update_table_row')[0]).toMatchObject({ originalPkValues: { id: 1 } })
    expect(ipc.calls('update_result_cell')[0]).toMatchObject({
      tabId: TAB,
      rowIndex: 0,
      resultIndex: 0,
      updates: { 1: 'Zed' },
    })
    // Same view version: the saved row is patched where it is shown.
    expect(rowsOf(TAB)).toEqual([
      [3, 'Dana'],
      [1, 'Zed'],
    ])
    const result = useQueryStore.getState().tabs[TAB]!.results[0]
    expect(result.viewVersion).toBe(4)
    expect(result.editState).toBeNull()
  })
})
