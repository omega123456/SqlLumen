import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipc, expectToast } from '../ipc-mock'
import { loadTablePage, tablePageResponse } from '../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../helpers/column-meta-fixtures'
import { resetWorkspaceStore } from '../helpers/workspace-test-utils'
import { rowsOf } from '../helpers/query-test-utils'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { getResultSurface } from '../../lib/result-window-cache'
import { tableSurfaceRef, useTableDataStore } from '../../stores/table-data-store'
import { routeOf } from '../../stores/data-view/route-registry'
import { applyFilters, setSelectedRow, sortView } from '../../stores/data-view/view-actions'
import {
  discardCurrentRow,
  insertDraftRow,
  startEditingRow,
  updateCellValue,
} from '../../stores/data-view/edit-actions'
import { saveCurrentRow } from '../../stores/data-view/row-save'
import { deleteRows } from '../../stores/data-view/row-deletion'
import type { ForeignKeyInfo, PrimaryKeyInfo, TablePageResult } from '../../types/schema'

const TAB_ID = 'tab-1'

const REF = tableSurfaceRef(TAB_ID)

const COLUMNS = [
  makeTableColumnMeta({ name: 'id', dataType: 'INT', isPrimaryKey: true, isAutoIncrement: true }),
  makeTableColumnMeta({ name: 'name', dataType: 'VARCHAR', isNullable: true }),
]

const PRIMARY_KEY: PrimaryKeyInfo = {
  keyColumns: ['id'],
  hasAutoIncrement: true,
  isUniqueKeyFallback: false,
}

const ROWS = [
  [1, 'Alice'],
  [2, 'Bob'],
]

const PAGE = { columns: COLUMNS, rows: ROWS, primaryKey: PRIMARY_KEY }

const INACTIVE_EVICTION_DELAY_MS = 30 * 60 * 1000

function tab() {
  return useTableDataStore.getState().tabs[TAB_ID]
}

function lastPageRequest() {
  const requests = ipc.payloads('fetch_table_page')
  return requests[requests.length - 1]
}

function showTableTab(visibleConnectionId: string) {
  resetWorkspaceStore({ visibleConnectionSessionId: visibleConnectionId })
  useWorkspaceStore.setState({
    tabsByConnection: {
      'conn-1': [
        {
          id: TAB_ID,
          type: 'table-data',
          label: 'users',
          connectionId: 'conn-1',
          databaseName: 'mydb',
          objectName: 'users',
          objectType: 'table',
        },
      ],
    },
    activeTabByConnection: { 'conn-1': TAB_ID },
  })
}

function deferredPage() {
  let resolvePage: (page: TablePageResult) => void = () => {}
  let rejectPage: (reason: Error) => void = () => {}
  const pending = new Promise<TablePageResult>((resolve, reject) => {
    resolvePage = resolve
    rejectPage = reject
  })
  return { pending, resolvePage, rejectPage }
}

beforeEach(() => {
  vi.useRealTimers()
  frontendCacheLifecycle.cleanup()
  useTableDataStore.setState({ tabs: {}, columnJumpRequests: {}, highlightedColumnByTab: {} })
  showTableTab('conn-1')
  useToastStore.setState({ toasts: [] })
  _resetToastTimeoutsForTests()
  ipc.override('get_table_foreign_keys', () => [])
})

describe('useTableDataStore — column jumps', () => {
  it('keeps a pre-init request and increments the nonce for repeat jumps', async () => {
    const store = useTableDataStore.getState()

    store.requestColumnJump(TAB_ID, 'name')
    await loadTablePage(TAB_ID, PAGE)
    expect(useTableDataStore.getState().columnJumpRequests[TAB_ID]).toEqual({
      columnName: 'name',
      nonce: 1,
    })

    store.requestColumnJump(TAB_ID, 'name')
    expect(useTableDataStore.getState().columnJumpRequests[TAB_ID]?.nonce).toBe(2)
  })

  it('consumes a request into the highlight and clears it', () => {
    const store = useTableDataStore.getState()
    store.requestColumnJump(TAB_ID, 'name')
    store.consumeColumnJump(TAB_ID)

    expect(useTableDataStore.getState().columnJumpRequests[TAB_ID]).toBeUndefined()
    expect(useTableDataStore.getState().highlightedColumnByTab[TAB_ID]).toBe('name')

    store.clearColumnHighlight(TAB_ID)
    expect(useTableDataStore.getState().highlightedColumnByTab[TAB_ID]).toBeNull()
  })
})

describe('useTableDataStore — page fetches', () => {
  it('loads page 1 into a result slot and seeds the window cache with an identity edit target', async () => {
    await loadTablePage(TAB_ID, PAGE)

    expect(lastPageRequest()).toMatchObject({
      connectionId: 'conn-1',
      tabId: TAB_ID,
      database: 'mydb',
      table: 'users',
      page: 1,
      pageSize: 1000,
      sortColumn: null,
      filterModel: null,
    })
    expect(tab().page).toMatchObject({ currentPage: 1, fetchedRowCount: 2, isLoading: false })
    expect(tab().meta.primaryKey).toEqual(PRIMARY_KEY)
    expect(tab().view.slot).toMatchObject({ queryId: 'table-page-1', viewRowCount: 2 })
    expect(rowsOf(TAB_ID, 0)).toEqual(ROWS)
    expect(getResultSurface(TAB_ID, 0)?.slot.queryId).toBe('table-page-1')
    expect(tab().view.editTarget.tableName).toBe('mydb.users')
    expect(tab().view.editTarget.bindings).toEqual(
      new Map([
        [0, 'id'],
        [1, 'name'],
      ])
    )
  })

  it('leaves the edit target empty for a table without a key', async () => {
    await loadTablePage(TAB_ID, { ...PAGE, primaryKey: null })

    expect(tab().view.editTarget.tableName).toBeNull()
  })

  it('normalizes boolean alias cells to integers when loading a page', async () => {
    const columns = [
      COLUMNS[0],
      makeTableColumnMeta({ name: 'is_admin', dataType: 'TINYINT', isBooleanAlias: true }),
    ]
    await loadTablePage(TAB_ID, {
      columns: columns,
      rows: [
        [1, true],
        [2, false],
      ],
    })

    expect(rowsOf(TAB_ID, 0)).toEqual([
      [1, 1],
      [2, 0],
    ])
  })

  it('selects the first or last row of a page reached from form navigation', async () => {
    await loadTablePage(TAB_ID, PAGE)

    await useTableDataStore.getState().fetchPage(TAB_ID, { page: 2, select: 'first' })
    expect(lastPageRequest()).toMatchObject({ page: 2 })
    expect(tab().view.selection.rowIndex).toBe(0)

    await useTableDataStore.getState().fetchPage(TAB_ID, { page: 1, select: 'last' })
    expect(tab().view.selection.rowIndex).toBe(1)
  })

  it('records a failed fetch as the page error but ignores a superseded fetch', async () => {
    await loadTablePage(TAB_ID, PAGE)

    ipc.override('fetch_table_page', () => {
      throw new Error('table_page_superseded: a newer fetch replaced this page')
    })
    await useTableDataStore.getState().refreshData(TAB_ID)
    expect(tab().page.error).toBeNull()
    expect(ipc.payloads('log_frontend')).toContainEqual({
      level: 'info',
      message:
        '[table-data] superseded page fetch ignored: table_page_superseded: a newer fetch replaced this page',
    })

    ipc.override('fetch_table_page', () => {
      throw new Error('Access denied')
    })
    await useTableDataStore.getState().refreshData(TAB_ID)
    expect(tab().page).toMatchObject({ isLoading: false })
    expect(tab().page.error).toContain('Access denied')
  })

  it('drops a fetch that completes after the tab was cleaned up and evicts its slot', async () => {
    const page = deferredPage()
    ipc.override('fetch_table_page', () => page.pending)
    useTableDataStore.getState().initTab(TAB_ID, {
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      isView: false,
    })
    const fetching = useTableDataStore.getState().fetchPage(TAB_ID, { page: 1, select: null })

    useTableDataStore.getState().cleanupTab(TAB_ID)
    page.resolvePage(tablePageResponse(PAGE))
    await fetching

    expect(tab()).toBeUndefined()
    expect(ipc.payloads('evict_results')).toEqual([{ connectionId: 'conn-1', tabId: TAB_ID }])
  })

  it('refetches page 1 in SQL when the sort, filters or page size change', async () => {
    await loadTablePage(TAB_ID, PAGE)
    await useTableDataStore.getState().fetchPage(TAB_ID, { page: 3, select: null })

    await sortView(REF, { column: 'name', direction: 'desc' })
    expect(lastPageRequest()).toMatchObject({ page: 1, sortColumn: 'name', sortDirection: 'desc' })

    applyFilters(REF, [{ column: 'name', operator: '==', value: 'Bob' }])
    await vi.waitFor(() =>
      expect(lastPageRequest()).toMatchObject({
        page: 1,
        filterModel: [{ column: 'name', operator: '==', value: 'Bob' }],
      })
    )
    await vi.waitFor(() => expect(tab().page.isLoading).toBe(false))

    await useTableDataStore.getState().setPageSize(TAB_ID, 500)
    expect(lastPageRequest()).toMatchObject({ page: 1, pageSize: 500 })
    expect(tab().view.spec.sort).toEqual({ column: 'name', direction: 'desc' })
  })
})

describe('useTableDataStore — foreign keys', () => {
  it('keeps single-column foreign keys and loads the page when the lookup fails', async () => {
    const foreignKeys: ForeignKeyInfo[] = [
      {
        name: 'fk_simple',
        columnName: 'author_id',
        referencedDatabase: 'mydb',
        referencedTable: 'authors',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
      {
        name: 'fk_composite',
        columnName: 'org_id',
        referencedDatabase: 'mydb',
        referencedTable: 'orgs',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
      {
        name: 'fk_composite',
        columnName: 'dept_id',
        referencedDatabase: 'mydb',
        referencedTable: 'orgs',
        referencedColumn: 'dept_id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ]
    ipc.override('get_table_foreign_keys', () => foreignKeys)
    await loadTablePage(TAB_ID, PAGE)

    const simpleForeignKey = {
      columnName: 'author_id',
      referencedDatabase: 'mydb',
      referencedTable: 'authors',
      referencedColumn: 'id',
      constraintName: 'fk_simple',
    }
    await vi.waitFor(() => expect(tab().meta.foreignKeys).toEqual([simpleForeignKey]))
    expect(tab().view.editTarget.foreignKeys).toEqual([simpleForeignKey])

    ipc.override('get_table_foreign_keys', () => {
      throw new Error('FK fetch error')
    })
    await useTableDataStore.getState().loadTableData(TAB_ID)

    expect(tab().meta.foreignKeys).toEqual([])
    expect(rowsOf(TAB_ID, 0)).toEqual(ROWS)
    expect(tab().page.error).toBeNull()
  })
})

describe('useTableDataStore — rows inserted on the table route', () => {
  async function saveInsertedRow() {
    ipc.override('insert_table_row', () => [
      ['id', 3],
      ['name', 'Charlie'],
    ])
    insertDraftRow(REF)
    updateCellValue(REF, 1, 'Charlie')
    return saveCurrentRow(REF)
  }

  it('appends the inserted row to the slot and selects it instead of re-running the page', async () => {
    await loadTablePage(TAB_ID, PAGE)
    ipc.override('append_result_row', () => ({
      baseIndex: 2,
      viewVersion: 2,
      viewRowCount: 3,
      totalRows: 3,
      window: { offset: 2, rows: [[3, 'Charlie']], baseIndices: [2] },
    }))

    await expect(saveInsertedRow()).resolves.toBe(true)

    expect(ipc.payloads('append_result_row')).toEqual([
      expect.objectContaining({
        tabId: TAB_ID,
        resultIndex: 0,
        queryId: 'table-page-1',
        baseViewVersion: 1,
        row: [3, 'Charlie'],
      }),
    ])
    expect(ipc.payloads('fetch_table_page')).toHaveLength(1)
    expect(rowsOf(TAB_ID, 0)).toEqual([...ROWS, [3, 'Charlie']])
    expect(tab().view.selection.rowIndex).toBe(2)
    expect(tab().view.slot.viewRowCount).toBe(3)
  })

  it('reloads the current page when the slot refuses the appended row', async () => {
    await loadTablePage(TAB_ID, PAGE)
    ipc.override('append_result_row', () => {
      throw new Error('view_superseded: current=2')
    })

    await saveInsertedRow()

    await vi.waitFor(() => expect(ipc.payloads('fetch_table_page')).toHaveLength(2))
  })
})

describe('useTableDataStore — expired pages', () => {
  it('refetches the current page once it expires, but not while an edit is dirty', async () => {
    await loadTablePage(TAB_ID, PAGE)
    routeOf(REF).lifecycle.onExpired(REF)
    await vi.waitFor(() => expect(ipc.payloads('fetch_table_page')).toHaveLength(2))
    await vi.waitFor(() => expect(tab().view.residency.rows.status).not.toBe('restoring'))

    insertDraftRow(REF)
    updateCellValue(REF, 1, 'Draft')

    routeOf(REF).lifecycle.onExpired(REF)
    expect(tab().view.residency.isExpired).toBe(true)
    expect(ipc.payloads('fetch_table_page')).toHaveLength(2)

    discardCurrentRow(REF)

    await vi.waitFor(() => expect(ipc.payloads('fetch_table_page')).toHaveLength(3))
    await vi.waitFor(() => expect(tab().view.residency.isExpired).toBe(false))
    expect(lastPageRequest()).toMatchObject({ page: 1 })
  })

  it('refetches a page that expired during an edit once the row is saved', async () => {
    await loadTablePage(TAB_ID, PAGE)
    startEditingRow(REF, 0)
    updateCellValue(REF, 1, 'Alicia')
    routeOf(REF).lifecycle.onExpired(REF)
    ipc.override('update_table_row', () => undefined)
    ipc.override('update_result_cell', () => {
      throw new Error('disk full')
    })

    await expect(saveCurrentRow(REF)).resolves.toBe(true)

    await expectToast('warning', 'cache may be stale. Reload the table to refresh.')
    await vi.waitFor(() => expect(ipc.payloads('fetch_table_page')).toHaveLength(2))
  })
})

describe('useTableDataStore — rows deleted on the table route', () => {
  it('tells the user to reload the table when the slot cannot drop the deleted row', async () => {
    await loadTablePage(TAB_ID, PAGE)
    setSelectedRow(REF, 0)
    ipc.override('delete_table_row', () => undefined)
    ipc.override('remove_result_rows', () => {
      throw new Error('cache write failed')
    })

    await expect(deleteRows(REF)).resolves.toBe(1)

    await expectToast(
      'error',
      "1 row deleted, but the result couldn't be updated. Reload the table to refresh."
    )
  })
})

describe('useTableDataStore — row residency', () => {
  it('starts the eviction timer for a page that lands hidden and restores it through a window read', async () => {
    vi.useFakeTimers()
    showTableTab('conn-2')
    await loadTablePage(TAB_ID, PAGE)

    expect(tab().view.residency.rows).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
    expect(frontendCacheLifecycle.hasInactiveTimer('table-data:tab-1')).toBe(true)

    await vi.advanceTimersByTimeAsync(INACTIVE_EVICTION_DELAY_MS)
    expect(tab().view.residency.rows.status).toBe('evicted')
    expect(rowsOf(TAB_ID, 0)).toEqual([])
    vi.useRealTimers()

    ipc.override('fetch_result_window', () => ({
      offset: 0,
      rows: ROWS,
      baseIndices: [0, 1],
      viewRowCount: 2,
      viewVersion: 1,
    }))
    await useTableDataStore.getState().markTableDataSurfaceActive(TAB_ID)

    expect(tab().view.residency.rows).toMatchObject({ status: 'resident', isActive: true })
    expect(rowsOf(TAB_ID, 0)).toEqual(ROWS)
    expect(ipc.payloads('fetch_table_page')).toHaveLength(1)
  })
})

describe('useTableDataStore — cancelLoad', () => {
  it('issues cancel_query once and reports the interrupted fetch as a cancellation', async () => {
    await loadTablePage(TAB_ID, PAGE)
    await useTableDataStore.getState().cancelLoad(TAB_ID)
    expect(ipc.payloads('cancel_query')).toHaveLength(0)

    const page = deferredPage()
    ipc.override('fetch_table_page', () => page.pending)
    ipc.override('cancel_query', () => true)
    const fetching = useTableDataStore.getState().refreshData(TAB_ID)

    await useTableDataStore.getState().cancelLoad(TAB_ID)
    await useTableDataStore.getState().cancelLoad(TAB_ID)

    expect(ipc.payloads('cancel_query')).toEqual([
      expect.objectContaining({ connectionId: 'conn-1', tabId: TAB_ID }),
    ])
    expect(tab().page.isCancelling).toBe(true)
    await expectToast('success', 'Query cancelled')

    page.rejectPage(new Error('Data query failed: query execution was interrupted'))
    await fetching

    expect(tab().page).toMatchObject({
      error: 'Query cancelled by user',
      isLoading: false,
      isCancelling: false,
    })
  })

  it('clears isCancelling when no running query is found and lets the fetch finish', async () => {
    await loadTablePage(TAB_ID, PAGE)
    const page = deferredPage()
    ipc.override('fetch_table_page', () => page.pending)
    ipc.override('cancel_query', () => false)
    const fetching = useTableDataStore.getState().refreshData(TAB_ID)

    await useTableDataStore.getState().cancelLoad(TAB_ID)
    expect(tab().page.isCancelling).toBe(false)

    page.resolvePage(tablePageResponse(PAGE))
    await fetching
    expect(tab().page).toMatchObject({ isLoading: false, error: null })
  })
})
