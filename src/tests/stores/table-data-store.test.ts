import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipc, expectToast } from '../ipc-mock'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import { frontendCacheLifecycle } from '../../lib/frontend-cache-lifecycle'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetWorkspaceStore } from '../helpers/workspace-test-utils'
import type {
  TableDataResponse,
  PrimaryKeyInfo,
  TableDataColumnMeta,
  ForeignKeyInfo,
} from '../../types/schema'
import {
  useTableDataStore,
  buildInsertPayload,
  buildUpdatePayload,
} from '../../stores/table-data-store'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockColumns: TableDataColumnMeta[] = [
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
]

const mockPrimaryKey: PrimaryKeyInfo = {
  keyColumns: ['id'],
  hasAutoIncrement: true,
  isUniqueKeyFallback: false,
}

const mockResponse: TableDataResponse = {
  columns: mockColumns,
  rows: [
    [1, 'Alice'],
    [2, 'Bob'],
  ],
  currentPage: 1,
  pageSize: 1000,
  primaryKey: mockPrimaryKey,
  executionTimeMs: 42,
}

const booleanAliasColumns: TableDataColumnMeta[] = [
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
    name: 'is_admin',
    dataType: 'TINYINT',
    isBooleanAlias: true,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useRealTimers()
  frontendCacheLifecycle.cleanup()
  useTableDataStore.setState({ tabs: {} })
  resetWorkspaceStore()
  useToastStore.setState({ toasts: [] })
  _resetToastTimeoutsForTests()
  // Default IPC overrides
  ipc.override('fetch_table_data', () => mockResponse)
  ipc.override('touch_table_data', () => ({ status: 'available' }))
  ipc.override('evict_table_data', () => undefined)
  ipc.override('update_table_row', () => undefined)
  ipc.override('insert_table_row', () => [
    ['id', 3],
    ['name', 'Charlie'],
  ])
  ipc.override('delete_table_row', () => undefined)
  ipc.override('get_table_foreign_keys', () => [])
})

// Helper: init a tab with data loaded
async function setupTabWithData(tabId = 'tab-1') {
  const store = useTableDataStore.getState()
  store.initTab(tabId, 'conn-1', 'mydb', 'users')
  await store.fetchPage(tabId, 1)
  return useTableDataStore.getState().tabs[tabId]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTableDataStore — initTab', () => {
  it('creates correct default state', () => {
    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    const tab = useTableDataStore.getState().tabs['tab-1']

    expect(tab).toBeDefined()
    expect(tab.connectionId).toBe('conn-1')
    expect(tab.database).toBe('mydb')
    expect(tab.table).toBe('users')
    expect(tab.columns).toEqual([])
    expect(tab.rows).toEqual([])
    expect(tab.currentPage).toBe(1)
    expect(tab.pageSize).toBe(1000)
    expect(tab.primaryKey).toBeNull()
    expect(tab.executionTimeMs).toBe(0)
    expect(tab.editState).toBeNull()
    expect(tab.viewMode).toBe('grid')
    expect(tab.rowsEvictedAt).toBeNull()
    expect(tab.selectedRowKey).toBeNull()
    expect(tab.filterModel).toEqual([])
    expect(tab.sort).toBeNull()
    expect(tab.isLoading).toBe(false)
    expect(tab.error).toBeNull()
    expect(tab.saveError).toBeNull()
    expect(tab.isExportDialogOpen).toBe(false)
    expect(tab.pendingNavigationAction).toBeNull()
  })

  it('should have scrollRow and scrollCol fields in tab state', () => {
    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    const tab = useTableDataStore.getState().tabs['tab-1']

    expect(tab.scrollRow).toBe(0)
    expect(tab.scrollCol).toBe(0)
  })
})

describe('useTableDataStore — setScrollCell', () => {
  it('should expose a setScrollCell action to save scroll cell coordinates', () => {
    const store = useTableDataStore.getState()
    expect(typeof store.setScrollCell).toBe('function')
  })

  it('should retain scroll cell coordinates after being set', async () => {
    await setupTabWithData()

    useTableDataStore.getState().setScrollCell('tab-1', 15, 3)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.scrollRow).toBe(15)
    expect(tab.scrollCol).toBe(3)
  })

  it('resets scroll cell coordinates before dataset-shape changes restore', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setScrollCell('tab-1', 15, 3)

    ipc.override('fetch_table_data', () => mockResponse)
    await useTableDataStore.getState().sortByColumn('tab-1', 'name', 'asc')
    expect(useTableDataStore.getState().tabs['tab-1']).toMatchObject({ scrollRow: 0, scrollCol: 3 })

    useTableDataStore.getState().setScrollCell('tab-1', 15, 3)
    ipc.override('fetch_table_data', () => mockResponse)
    await useTableDataStore
      .getState()
      .applyFilters('tab-1', [{ column: 'name', operator: '==' as const, value: 'Alice' }])
    expect(useTableDataStore.getState().tabs['tab-1']).toMatchObject({ scrollRow: 0, scrollCol: 0 })

    useTableDataStore.getState().setScrollCell('tab-1', 15, 3)
    ipc.override('fetch_table_data', () => mockResponse)
    await useTableDataStore.getState().fetchPage('tab-1', 2)
    expect(useTableDataStore.getState().tabs['tab-1']).toMatchObject({ scrollRow: 0, scrollCol: 0 })

    useTableDataStore.getState().setScrollCell('tab-1', 15, 3)
    ipc.override('fetch_table_data', () => mockResponse)
    await useTableDataStore.getState().refreshData('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1']).toMatchObject({
      scrollRow: 15,
      scrollCol: 3,
    })
  })
})

describe('useTableDataStore — loadTableData', () => {
  it('calls fetchTableData and populates state', async () => {
    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().loadTableData('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.columns).toEqual(mockColumns)
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(tab.primaryKey).toEqual(mockPrimaryKey)
    expect(tab.isLoading).toBe(false)
    expect(tab.error).toBeNull()
    expect(ipc.calls('fetch_table_data').length).toBe(1)
  })

  it('resets editState and errors on load', async () => {
    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    // Set some state that should be reset
    useTableDataStore.setState((s) => ({
      tabs: {
        ...s.tabs,
        'tab-1': {
          ...s.tabs['tab-1'],
          editState: {
            rowKey: { id: 1 },
            originalValues: { id: 1 },
            currentValues: { id: 1 },
            modifiedColumns: new Set<string>(),
            isNewRow: false,
          },
          saveError: 'old error',
        },
      },
    }))

    await useTableDataStore.getState().loadTableData('tab-1')
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    expect(tab.saveError).toBeNull()
    expect(tab.error).toBeNull()
  })
})

describe('useTableDataStore — fetchPage', () => {
  it('calls fetchTableData with correct page number', async () => {
    const page2Response: TableDataResponse = {
      ...mockResponse,
      rows: [
        [3, 'Charlie'],
        [4, 'Dave'],
      ],
      currentPage: 2,
    }
    // First call returns mockResponse (from beforeEach override)
    // Second call returns page2Response
    let callCount = 0
    ipc.override('fetch_table_data', () => {
      callCount++
      return callCount === 1 ? mockResponse : page2Response
    })

    await setupTabWithData()
    await useTableDataStore.getState().fetchPage('tab-1', 2)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([
      [3, 'Charlie'],
      [4, 'Dave'],
    ])
    expect(tab.currentPage).toBe(2)
    expect(ipc.calls('fetch_table_data').length).toBe(2)
    expect(ipc.calls('fetch_table_data')[1]).toMatchObject({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      page: 2,
    })
  })

  it('clears selectedRowKey after a successful page fetch', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setSelectedRow('tab-1', { id: 1 })

    await useTableDataStore.getState().fetchPage('tab-1', 1)

    expect(useTableDataStore.getState().tabs['tab-1'].selectedRowKey).toBeNull()
  })

  it('clears checkedRowKeys after a successful page fetch (avoids deleting stale rows)', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setCheckedRowKeys('tab-1', [{ id: 1 }, { id: 2 }])
    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([
      { id: 1 },
      { id: 2 },
    ])

    await useTableDataStore.getState().fetchPage('tab-1', 2)

    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([])
  })

  it('clears checkedRowKeys after sorting (sort funnels through fetchPage)', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setCheckedRowKeys('tab-1', [{ id: 1 }])

    await useTableDataStore.getState().sortByColumn('tab-1', 'name', 'asc')

    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([])
  })

  it('clears checkedRowKeys after applying a filter', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setCheckedRowKeys('tab-1', [{ id: 2 }])

    await useTableDataStore
      .getState()
      .applyFilters('tab-1', [{ column: 'name', operator: '==' as const, value: 'Alice' }])

    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([])
  })

  it('clears checkedRowKeys after refreshing data', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setCheckedRowKeys('tab-1', [{ id: 1 }])

    await useTableDataStore.getState().refreshData('tab-1')

    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([])
  })

  it('resets rowsEvictedAt after a successful page fetch', async () => {
    await setupTabWithData()
    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          rows: [],
          rowsEvictedAt: 1234,
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: 1234,
          },
        },
      },
    }))

    await useTableDataStore.getState().fetchPage('tab-1', 1)

    expect(useTableDataStore.getState().tabs['tab-1'].rowsEvictedAt).toBeNull()
  })

  it('sets error on IPC failure', async () => {
    ipc.override('fetch_table_data', () => {
      throw new Error('Fetch failed')
    })

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().fetchPage('tab-1', 1)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.error).toBe('Fetch failed')
    expect(tab.isLoading).toBe(false)
  })

  it('records rowsEvictedAt when inactive rows are evicted', async () => {
    await setupTabWithData()

    useTableDataStore.getState().evictInactiveTableDataRows('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rowResidency?.status).toBe('evicted')
    expect(tab.rowsEvictedAt).toBeTypeOf('number')
  })

  it('skips state update if tab was cleaned up during fetch', async () => {
    let resolvePromise: ((value: TableDataResponse) => void) | null = null
    ipc.override(
      'fetch_table_data',
      () =>
        new Promise<TableDataResponse>((resolve) => {
          resolvePromise = resolve
        })
    )

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    const promise = useTableDataStore.getState().fetchPage('tab-1', 1)

    // Clean up the tab mid-flight
    useTableDataStore.getState().cleanupTab('tab-1')

    resolvePromise!(mockResponse)
    await promise

    expect(useTableDataStore.getState().tabs['tab-1']).toBeUndefined()
  })

  it('normalizes boolean alias cells to integers when loading table data', async () => {
    ipc.override('fetch_table_data', () => ({
      columns: booleanAliasColumns,
      rows: [[1, true]],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: mockPrimaryKey,
      executionTimeMs: 12,
    }))

    useTableDataStore.getState().initTab('tab-bool', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().fetchPage('tab-bool', 1)

    expect(useTableDataStore.getState().tabs['tab-bool'].rows).toEqual([[1, 1]])
  })

  it('preserves the latest row residency visibility after an in-flight fetch completes', async () => {
    const deferred: { resolve?: (value: TableDataResponse) => void } = {}
    ipc.override(
      'fetch_table_data',
      () =>
        new Promise<TableDataResponse>((resolve) => {
          deferred.resolve = resolve
        })
    )

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')

    const fetchPromise = useTableDataStore.getState().fetchPage('tab-1', 1)
    useTableDataStore.getState().markTableDataSurfaceActive('tab-1')
    useTableDataStore.getState().markTableDataSurfaceInactive('tab-1')
    if (!deferred.resolve) {
      throw new Error('Expected fetch_table_data resolver')
    }
    deferred.resolve(mockResponse)
    await fetchPromise

    expect(useTableDataStore.getState().tabs['tab-1'].rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
  })
})

describe('useTableDataStore — backend cache lifecycle', () => {
  it('evicts backend cache when cleaning up a tab', async () => {
    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')

    useTableDataStore.getState().cleanupTab('tab-1')

    expect(ipc.calls('evict_table_data')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })
    expect(useTableDataStore.getState().tabs['tab-1']).toBeUndefined()
  })

  it('logs a warning when cleanup cache eviction fails', async () => {
    ipc.override('evict_table_data', () => {
      throw new Error('evict failed')
    })
    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')

    useTableDataStore.getState().cleanupTab('tab-1')

    await vi.waitFor(() => {
      expect(ipc.calls('log_frontend')).toContainEqual({
        level: 'warn',
        message: 'Table data cache eviction failed for tab tab-1: evict failed',
      })
    })
  })

  it('syncs backend cache after a successful insert', async () => {
    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Charlie')

    const result = await useTableDataStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(ipc.calls('sync_table_data_cache_after_insert')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: mockColumns,
      rows: [
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Charlie'],
      ],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: mockPrimaryKey,
      executionTimeMs: 42,
    })
  })

  it('syncs backend cache after a successful update', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    const result = await useTableDataStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(ipc.calls('sync_table_data_cache_after_update')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: mockColumns,
      rows: [
        [1, 'Updated'],
        [2, 'Bob'],
      ],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: mockPrimaryKey,
      executionTimeMs: 42,
    })
  })

  it('syncs backend cache after a successful delete', async () => {
    await setupTabWithData()

    await useTableDataStore.getState().deleteRow('tab-1', { id: 1 })

    expect(ipc.calls('sync_table_data_cache_after_delete')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
      columns: mockColumns,
      rows: [[2, 'Bob']],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: mockPrimaryKey,
      executionTimeMs: 42,
    })
  })

  it('evicts backend cache when cache sync returns a non-synced status after save', async () => {
    ipc.override('sync_table_data_cache_after_update', () => ({ status: 'missing' }))

    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    const result = await useTableDataStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(ipc.calls('evict_table_data')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })
  })

  it('evicts backend cache when cache sync throws after delete', async () => {
    ipc.override('sync_table_data_cache_after_delete', () => {
      throw new Error('sync failed')
    })

    await setupTabWithData()

    await useTableDataStore.getState().deleteRow('tab-1', { id: 1 })

    expect(ipc.calls('evict_table_data')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })
  })
})

describe('useTableDataStore — frontend row residency lifecycle', () => {
  it('marks loaded rows as resident after fetches and refreshes', async () => {
    await setupTabWithData()
    let tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })

    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: 123,
          },
          rows: [],
        },
      },
    }))

    await useTableDataStore.getState().refreshData('tab-1')

    tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
  })

  it('evicts inactive resident rows while preserving metadata and clearing clean edit state', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().setCheckedRowKeys('tab-1', [{ id: 1 }, { id: 2 }])
    useTableDataStore.getState().markTableDataSurfaceInactive('tab-1')

    expect(frontendCacheLifecycle.hasInactiveTimer('table-data:tab-1')).toBe(true)

    useTableDataStore.getState().evictInactiveTableDataRows('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([])
    expect(tab.columns).toEqual(mockColumns)
    expect(tab.primaryKey).toEqual(mockPrimaryKey)
    expect(tab.editState).toBeNull()
    expect(tab.selectedRowKey).toBeNull()
    // Stale checked keys must be cleared so a later delete cannot hit unintended rows.
    expect(tab.checkedRowKeys).toEqual([])
    expect(tab.rowResidency).toMatchObject({
      status: 'evicted',
      isActive: false,
    })
    expect(frontendCacheLifecycle.hasInactiveTimer('table-data:tab-1')).toBe(false)
  })

  it('does not evict dirty edit state', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')
    useTableDataStore.getState().markTableDataSurfaceInactive('tab-1')
    useTableDataStore.getState().evictInactiveTableDataRows('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(tab.editState).not.toBeNull()
    expect(tab.rowResidency?.status).toBe('resident')
  })

  it('restores evicted rows from table-data cache without calling fetch_table_data', async () => {
    await setupTabWithData()
    ipc.override('restore_table_data_cache', () => ({
      status: 'available',
      data: {
        ...mockResponse,
        rows: [[9, 'Restored']],
      },
    }))

    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: 55,
          },
        },
      },
    }))

    const fetchCallsBefore = ipc.calls('fetch_table_data').length
    await useTableDataStore.getState().markTableDataSurfaceActive('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([[9, 'Restored']])
    expect(tab.rowResidency).toEqual({
      status: 'resident',
      isActive: true,
      inactiveSince: null,
    })
    expect(ipc.calls('restore_table_data_cache')).toContainEqual({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      database: 'mydb',
      table: 'users',
    })
    expect(ipc.calls('fetch_table_data')).toHaveLength(fetchCallsBefore)
  })

  it('sets a retryable error when restore reports expired or missing', async () => {
    await setupTabWithData()
    ipc.override('restore_table_data_cache', () => ({
      status: 'missing',
      data: null,
    }))

    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-1': {
          ...state.tabs['tab-1'],
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: null,
          },
        },
      },
    }))

    await useTableDataStore.getState().markTableDataSurfaceActive('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.error).toBe(
      'Cached table data is no longer available. Reload the table data to continue.'
    )
    expect(tab.rowResidency).toEqual({
      status: 'evicted',
      isActive: true,
      inactiveSince: null,
    })
  })

  it('keeps a hidden fetch completion inactive and immediately starts the TTL lifecycle', async () => {
    vi.useFakeTimers()
    useTableDataStore.getState().initTab('tab-hidden', 'conn-1', 'mydb', 'users')
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-hidden',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'mydb',
            objectName: 'users',
            objectType: 'table',
          },
          {
            id: 'tab-visible',
            type: 'query-editor',
            label: 'Query 1',
            connectionId: 'conn-1',
          },
        ],
      },
      activeTabByConnection: {
        'conn-1': 'tab-visible',
      },
      lastFocusedSurfaceByTab: {},
      blockingNavigationByTab: {},
      pendingCascadeClose: null,
    })

    await useTableDataStore.getState().fetchPage('tab-hidden', 1)

    const tab = useTableDataStore.getState().tabs['tab-hidden']
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(tab.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
    expect(frontendCacheLifecycle.hasInactiveTimer('table-data:tab-hidden')).toBe(true)

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    expect(useTableDataStore.getState().tabs['tab-hidden'].rowResidency?.status).toBe('evicted')
    vi.useRealTimers()
  })

  it('marks a fetch completion active when its connection is the globally visible connection', async () => {
    useTableDataStore.getState().initTab('tab-conn-visible', 'conn-1', 'mydb', 'users')
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-conn-visible',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'mydb',
            objectName: 'users',
            objectType: 'table',
          },
        ],
      },
      activeTabByConnection: { 'conn-1': 'tab-conn-visible' },
    })

    await useTableDataStore.getState().fetchPage('tab-conn-visible', 1)

    const tab = useTableDataStore.getState().tabs['tab-conn-visible']
    expect(tab.rowResidency).toEqual({
      status: 'resident',
      isActive: true,
      inactiveSince: null,
    })
    expect(frontendCacheLifecycle.hasInactiveTimer('table-data:tab-conn-visible')).toBe(false)
  })

  it('keeps a fetch completion inactive when the tab is selected but its connection is hidden', async () => {
    useTableDataStore.getState().initTab('tab-conn-hidden', 'conn-1', 'mydb', 'users')
    // The tab is the selected workspace tab for conn-1, but conn-2 is the
    // globally visible connection, so this completion must stay inactive.
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-2' })
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-conn-hidden',
            type: 'table-data',
            label: 'users',
            connectionId: 'conn-1',
            databaseName: 'mydb',
            objectName: 'users',
            objectType: 'table',
          },
        ],
      },
      activeTabByConnection: { 'conn-1': 'tab-conn-hidden' },
    })

    await useTableDataStore.getState().fetchPage('tab-conn-hidden', 1)

    const tab = useTableDataStore.getState().tabs['tab-conn-hidden']
    expect(tab.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
    expect(frontendCacheLifecycle.hasInactiveTimer('table-data:tab-conn-hidden')).toBe(true)
  })
})

describe('useTableDataStore — startEditing', () => {
  it('sets editState with deep-copied values', async () => {
    await setupTabWithData()

    const currentValues = { id: 1, name: 'Alice' }
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, currentValues)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.rowKey).toEqual({ id: 1 })
    expect(tab.editState!.originalValues).toEqual({ id: 1, name: 'Alice' })
    expect(tab.editState!.currentValues).toEqual({ id: 1, name: 'Alice' })
    expect(tab.editState!.modifiedColumns.size).toBe(0)
    expect(tab.editState!.isNewRow).toBe(false)

    // Verify deep copy: mutating original should not affect stored values
    currentValues.name = 'Modified'
    expect(tab.editState!.originalValues.name).toBe('Alice')
  })
})

describe('useTableDataStore — updateCellValue', () => {
  it('updates currentValues and adds to modifiedColumns', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })

    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState!.currentValues.name).toBe('Updated')
    expect(tab.editState!.modifiedColumns.has('name')).toBe(true)
    expect(tab.editState!.modifiedColumns.size).toBe(1)
  })

  it('does nothing if no editState', async () => {
    await setupTabWithData()
    // No editState — should not throw
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')
    expect(useTableDataStore.getState().tabs['tab-1'].editState).toBeNull()
  })

  it('syncCellValue updates the underlying row immediately for existing rows', async () => {
    await setupTabWithData()

    useTableDataStore
      .getState()
      .syncCellValue('tab-1', { id: 1, name: 'Alice', __rowIndex: 0 }, 'name', 'Updated')

    expect(useTableDataStore.getState().tabs['tab-1'].rows[0]).toEqual([1, 'Updated'])
  })

  it('syncCellValue honors the original row key when the primary key value changed', async () => {
    await setupTabWithData()

    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })

    useTableDataStore
      .getState()
      .syncCellValue('tab-1', { id: 10, name: 'Alice', __rowIndex: 0 }, 'id', 10, { id: 1 })

    expect(useTableDataStore.getState().tabs['tab-1'].rows[0]).toEqual([10, 'Alice'])
    expect(useTableDataStore.getState().tabs['tab-1'].editState?.rowKey).toEqual({ id: 10 })
    expect(useTableDataStore.getState().tabs['tab-1'].selectedRowKey).toBeNull()
  })
})

describe('useTableDataStore — saveCurrentRow (UPDATE path)', () => {
  it('calls updateTableRow with original PK values and updates row on success', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const updateCalls = ipc.calls('update_table_row')
    expect(updateCalls.length).toBeGreaterThan(0)
    const lastCall = updateCalls[updateCalls.length - 1] as Record<string, unknown>
    expect(lastCall?.connectionId).toBe('conn-1')
    expect(lastCall?.database).toBe('mydb')
    expect(lastCall?.table).toBe('users')
    expect(lastCall?.primaryKeyColumns).toEqual(['id'])
    expect(lastCall?.originalPkValues).toEqual({ id: 1 })
    expect(lastCall?.updatedValues).toEqual({ name: 'Updated' })

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    expect(tab.saveError).toBeNull()
    // Row should be updated in the rows array
    expect(tab.rows[0]).toEqual([1, 'Updated'])
  })

  it('sets saveError on failure (does NOT clear editState)', async () => {
    ipc.override('update_table_row', () => {
      throw new Error('Update failed')
    })

    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.saveError).toBe('Update failed')
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.currentValues.name).toBe('Updated')
  })

  it('clears editState without IPC call when no columns are modified', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    expect(ipc.calls('update_table_row').length).toBe(0)
    expect(useTableDataStore.getState().tabs['tab-1'].editState).toBeNull()
  })
})

describe('useTableDataStore — saveCurrentRow (INSERT path)', () => {
  it('calls insertTableRow for isNewRow=true and replaces temp row', async () => {
    await setupTabWithData()

    // Insert a new row
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Charlie')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const insertCalls = ipc.calls('insert_table_row')
    expect(insertCalls.length).toBeGreaterThan(0)
    const lastCall = insertCalls[insertCalls.length - 1] as Record<string, unknown>
    expect(lastCall?.connectionId).toBe('conn-1')
    expect(lastCall?.database).toBe('mydb')
    expect(lastCall?.table).toBe('users')
    expect((lastCall?.values as Record<string, unknown>)?.name).toBe('Charlie')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    // The temp row should be replaced with the returned data
    expect(tab.rows[tab.rows.length - 1]).toEqual([3, 'Charlie'])
  })

  it('normalizes boolean alias cells when replacing temp row after insert', async () => {
    ipc.override('insert_table_row', () => [
      ['id', 3],
      ['is_admin', true],
    ])

    useTableDataStore.getState().initTab('tab-insert-bool', 'conn-1', 'mydb', 'users')
    useTableDataStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        'tab-insert-bool': {
          ...state.tabs['tab-insert-bool'],
          columns: booleanAliasColumns,
          rows: [[null, null]],
          primaryKey: mockPrimaryKey,
          editState: {
            rowKey: { __tempId: 'tmp-1' },
            originalValues: {},
            currentValues: { is_admin: true },
            modifiedColumns: new Set(['is_admin']),
            isNewRow: true,
            tempId: 'tmp-1',
          },
        },
      },
    }))

    await useTableDataStore.getState().saveCurrentRow('tab-insert-bool')

    expect(useTableDataStore.getState().tabs['tab-insert-bool'].rows).toEqual([[3, 1]])
  })

  it('saves a cloned row through insert without copying generated primary keys', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setSelectedRow('tab-1', { id: 1 })
    useTableDataStore.getState().cloneSelectedRow('tab-1')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const insertCalls = ipc.calls('insert_table_row')
    expect(insertCalls.length).toBeGreaterThan(0)
    const lastCall = insertCalls[insertCalls.length - 1] as Record<string, unknown>
    expect(lastCall?.values).toEqual({ name: 'Alice' })
    expect(useTableDataStore.getState().tabs['tab-1'].selectedRowKey).toEqual({ id: 3 })
  })

  it('allows replacement natural primary-key values to be entered before saving a cloned row', async () => {
    const compositeColumns: TableDataColumnMeta[] = [
      {
        name: 'tenant_id',
        dataType: 'INT',
        isBooleanAlias: false,
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
      {
        name: 'user_id',
        dataType: 'INT',
        isBooleanAlias: false,
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
      {
        name: 'name',
        dataType: 'VARCHAR',
        isBooleanAlias: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    const compositePk: PrimaryKeyInfo = {
      keyColumns: ['tenant_id', 'user_id'],
      hasAutoIncrement: false,
      isUniqueKeyFallback: false,
    }
    ipc.override('fetch_table_data', () => ({
      columns: compositeColumns,
      rows: [[10, 1, 'Alice']],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: compositePk,
      executionTimeMs: 12,
    }))

    await setupTabWithData()
    useTableDataStore.getState().setSelectedRow('tab-1', { tenant_id: 10, user_id: 1 })
    useTableDataStore.getState().cloneSelectedRow('tab-1')
    useTableDataStore.getState().updateCellValue('tab-1', 'tenant_id', 11)
    useTableDataStore.getState().updateCellValue('tab-1', 'user_id', 2)

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const insertCalls = ipc.calls('insert_table_row')
    expect(insertCalls.length).toBeGreaterThan(0)
    const lastCall = insertCalls[insertCalls.length - 1] as Record<string, unknown>
    expect(lastCall?.values).toEqual({ tenant_id: 11, user_id: 2, name: 'Alice' })
  })

  it('sets saveError on insert failure', async () => {
    ipc.override('insert_table_row', () => {
      throw new Error('Insert failed')
    })

    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Charlie')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.saveError).toBe('Insert failed')
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.isNewRow).toBe(true)
  })

  it('sets saveError with actual message when invoke rejects with plain string (real Tauri behavior)', async () => {
    // Real Tauri invoke rejects with a plain string (not an Error object) for Result<T, String> commands
    ipc.override('insert_table_row', () => {
      throw "Duplicate entry '1' for key 'PRIMARY'"
    })

    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Charlie')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.saveError).toBe("Duplicate entry '1' for key 'PRIMARY'")
    expect(tab.editState).not.toBeNull()
  })
})

describe('useTableDataStore — discardCurrentRow', () => {
  it('restores original values for existing row', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    useTableDataStore.getState().discardCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    // Row should be restored to original
    expect(tab.rows[0]).toEqual([1, 'Alice'])
  })

  it('restores selectedRowKey after discarding a primary-key edit', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().setSelectedRow('tab-1', { id: 1 })
    useTableDataStore
      .getState()
      .syncCellValue('tab-1', { id: 10, name: 'Alice', __rowIndex: 0 }, 'id', 10, { id: 1 })
    useTableDataStore.getState().updateCellValue('tab-1', 'id', 10)

    useTableDataStore.getState().discardCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows[0]).toEqual([1, 'Alice'])
    expect(tab.selectedRowKey).toEqual({ id: 1 })
  })

  it('removes row from rows for new row', async () => {
    await setupTabWithData()
    const beforeCount = useTableDataStore.getState().tabs['tab-1'].rows.length

    useTableDataStore.getState().insertNewRow('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1'].rows.length).toBe(beforeCount + 1)

    useTableDataStore.getState().discardCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    expect(tab.rows.length).toBe(beforeCount)
  })

  it('removes only the cloned draft row when discarding', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setSelectedRow('tab-1', { id: 2 })
    useTableDataStore.getState().cloneSelectedRow('tab-1')

    useTableDataStore.getState().discardCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(tab.editState).toBeNull()
    expect(tab.selectedRowKey).toBeNull()
  })
})

describe('useTableDataStore — insertNewRow', () => {
  it('adds empty row and sets editState with isNewRow=true', async () => {
    await setupTabWithData()
    const beforeCount = useTableDataStore.getState().tabs['tab-1'].rows.length

    useTableDataStore.getState().insertNewRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows.length).toBe(beforeCount + 1)
    // Last row should be all nulls
    expect(tab.rows[tab.rows.length - 1]).toEqual([null, null])
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.isNewRow).toBe(true)
    expect(tab.editState!.tempId).toBeDefined()
    expect(tab.editState!.rowKey).toHaveProperty('__tempId')
  })

  it('prepopulates column defaults in new rows', async () => {
    const responseWithDefaults: TableDataResponse = {
      ...mockResponse,
      columns: [
        mockColumns[0],
        {
          name: 'status',
          dataType: 'ENUM',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: true,
          columnDefault: 'active',
          isBinary: false,
          isAutoIncrement: false,
          isBooleanAlias: false,
          enumValues: ['active', 'disabled'],
        },
      ],
      rows: [
        [1, 'active'],
        [2, 'disabled'],
      ],
    }
    ipc.override('fetch_table_data', () => responseWithDefaults)

    await setupTabWithData()

    useTableDataStore.getState().insertNewRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows[tab.rows.length - 1]).toEqual([null, 'active'])
    expect(tab.editState?.currentValues).toEqual({ id: null, status: 'active' })
    expect(tab.editState?.modifiedColumns).toEqual(new Set(['status']))
  })

  it('preserves empty-string defaults in new rows', async () => {
    const responseWithEmptyDefault: TableDataResponse = {
      ...mockResponse,
      columns: [
        mockColumns[0],
        {
          name: 'nickname',
          dataType: 'VARCHAR',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: true,
          columnDefault: '',
          isBinary: false,
          isAutoIncrement: false,
          isBooleanAlias: false,
        },
      ],
      rows: [[1, '']],
    }
    ipc.override('fetch_table_data', () => responseWithEmptyDefault)

    await setupTabWithData()

    useTableDataStore.getState().insertNewRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows[tab.rows.length - 1]).toEqual([null, ''])
    expect(tab.editState?.currentValues).toEqual({ id: null, nickname: '' })
    expect(tab.editState?.modifiedColumns).toEqual(new Set(['nickname']))
  })

  it('selects the temp row when inserting a new row', async () => {
    await setupTabWithData()

    useTableDataStore.getState().insertNewRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.selectedRowKey).toEqual({ __tempId: tab.editState!.tempId })
  })
})

describe('useTableDataStore — cloneSelectedRow', () => {
  it('creates a draft row from the selected persisted row with blank primary keys', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setSelectedRow('tab-1', { id: 1 })

    useTableDataStore.getState().cloneSelectedRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
      [null, 'Alice'],
    ])
    expect(tab.editState?.isNewRow).toBe(true)
    expect(tab.editState?.currentValues).toEqual({ id: null, name: 'Alice' })
    expect(tab.selectedRowKey).toEqual({ __tempId: tab.editState?.tempId })
  })

  it('does nothing when no persisted row is selected or a draft row already exists', async () => {
    await setupTabWithData()

    useTableDataStore.getState().cloneSelectedRow('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1'].rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])

    useTableDataStore.getState().setSelectedRow('tab-1', { id: 1 })
    useTableDataStore.getState().insertNewRow('tab-1')
    const rowCountBefore = useTableDataStore.getState().tabs['tab-1'].rows.length

    useTableDataStore.getState().cloneSelectedRow('tab-1')

    expect(useTableDataStore.getState().tabs['tab-1'].rows.length).toBe(rowCountBefore)
  })
})

describe('useTableDataStore — deleteRow (existing row)', () => {
  it('calls deleteTableRow IPC and removes from rows', async () => {
    await setupTabWithData()

    await useTableDataStore.getState().deleteRow('tab-1', { id: 1 })

    const deleteCalls = ipc.calls('delete_table_row')
    expect(deleteCalls.length).toBeGreaterThan(0)
    const lastCall = deleteCalls[deleteCalls.length - 1] as Record<string, unknown>
    expect(lastCall?.connectionId).toBe('conn-1')
    expect(lastCall?.database).toBe('mydb')
    expect(lastCall?.table).toBe('users')
    expect(lastCall?.pkColumns).toEqual(['id'])
    expect(lastCall?.pkValues).toEqual({ id: 1 })

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([[2, 'Bob']])
  })
})

describe('useTableDataStore — deleteRow (new row)', () => {
  it('removes from rows WITHOUT IPC call', async () => {
    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')
    const tempId = useTableDataStore.getState().tabs['tab-1'].editState!.tempId!
    const rowCountBefore = useTableDataStore.getState().tabs['tab-1'].rows.length

    await useTableDataStore.getState().deleteRow('tab-1', { __tempId: tempId })

    expect(ipc.calls('delete_table_row').length).toBe(0)
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows.length).toBe(rowCountBefore - 1)
  })
})

describe('useTableDataStore — requestNavigationAction', () => {
  it('executes action immediately with no edits', async () => {
    await setupTabWithData()

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)

    expect(action).toHaveBeenCalledTimes(1)
    expect(useTableDataStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
  })

  it('sets pendingNavigationAction with pending edits', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)

    expect(action).not.toHaveBeenCalled()
    expect(useTableDataStore.getState().tabs['tab-1'].pendingNavigationAction).toBe(action)
  })
})

describe('useTableDataStore — confirmNavigationSave', () => {
  it('saves, then executes action', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)
    expect(action).not.toHaveBeenCalled()

    await useTableDataStore.getState().confirmNavigationSave('tab-1')

    expect(ipc.calls('update_table_row').length).toBeGreaterThan(0)
    await expectToast('success', 'Row saved')
    expect(action).toHaveBeenCalledTimes(1)
    expect(useTableDataStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
  })

  it('does not save or navigate when temporal validation fails', async () => {
    const dateColumns: TableDataColumnMeta[] = [
      mockColumns[0],
      {
        name: 'd',
        dataType: 'DATE',
        isBooleanAlias: false,
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    const responseWithDate: TableDataResponse = {
      ...mockResponse,
      columns: dateColumns,
      rows: [
        [1, '2024-01-01'],
        [2, '2024-01-02'],
      ],
    }
    ipc.override('fetch_table_data', () => responseWithDate)

    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, d: '2024-01-01' })
    useTableDataStore.getState().updateCellValue('tab-1', 'd', 'not-a-date')

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)

    await useTableDataStore.getState().confirmNavigationSave('tab-1')

    await expectToast('error', '')
    expect(ipc.calls('update_table_row').length).toBe(0)
    expect(action).not.toHaveBeenCalled()
    expect(useTableDataStore.getState().tabs['tab-1'].pendingNavigationAction).not.toBeNull()
  })

  it('keeps pendingNavigationAction if save fails', async () => {
    ipc.override('update_table_row', () => {
      throw new Error('Save failed')
    })

    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)

    await useTableDataStore.getState().confirmNavigationSave('tab-1')

    expect(action).not.toHaveBeenCalled()
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.saveError).toBe('Save failed')
    // pendingNavigationAction should remain set
    expect(tab.pendingNavigationAction).not.toBeNull()
  })
})

describe('useTableDataStore — confirmNavigationDiscard', () => {
  it('discards, then executes action', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)
    expect(action).not.toHaveBeenCalled()

    useTableDataStore.getState().confirmNavigationDiscard('tab-1')

    expect(action).toHaveBeenCalledTimes(1)
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    expect(tab.pendingNavigationAction).toBeNull()
    // Row should be restored to original
    expect(tab.rows[0]).toEqual([1, 'Alice'])
  })
})

describe('useTableDataStore — cancelNavigation', () => {
  it('clears pendingNavigationAction', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    const action = vi.fn()
    useTableDataStore.getState().requestNavigationAction('tab-1', action)

    useTableDataStore.getState().cancelNavigation('tab-1')

    expect(useTableDataStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
})

describe('useTableDataStore — commitEditingRowIfNeeded', () => {
  it('does nothing with same row key', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 1 })

    expect(ipc.calls('update_table_row').length).toBe(0)
    // editState should remain
    expect(useTableDataStore.getState().tabs['tab-1'].editState).not.toBeNull()
  })

  it('calls saveCurrentRow with different row key', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 2 })

    expect(ipc.calls('update_table_row').length).toBeGreaterThan(0)
    // editState should be cleared on success
    expect(useTableDataStore.getState().tabs['tab-1'].editState).toBeNull()
  })

  it('sets saveError on failure, editState remains on original row', async () => {
    ipc.override('update_table_row', () => {
      throw new Error('Commit failed')
    })

    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 2 })

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.saveError).toBe('Commit failed')
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.rowKey).toEqual({ id: 1 })
  })

  it('does nothing when no editState', async () => {
    await setupTabWithData()

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 2 })

    expect(ipc.calls('update_table_row').length).toBe(0)
  })

  it('does nothing when no modifications', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    // Don't modify anything

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 2 })

    expect(ipc.calls('update_table_row').length).toBe(0)
  })
})

describe('useTableDataStore — clearEditStateIfUnmodified', () => {
  it('does not clear an untouched new row edit state', async () => {
    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')

    const tabBefore = useTableDataStore.getState().tabs['tab-1']
    const rowKey = tabBefore.editState!.rowKey

    useTableDataStore.getState().clearEditStateIfUnmodified('tab-1', rowKey)

    const tabAfter = useTableDataStore.getState().tabs['tab-1']
    expect(tabAfter.editState).not.toBeNull()
    expect(tabAfter.editState!.isNewRow).toBe(true)
  })
})

describe('useTableDataStore — sortByColumn', () => {
  it('sets sort and fetches page 1', async () => {
    await setupTabWithData()

    const sortedResponse: TableDataResponse = {
      ...mockResponse,
      rows: [
        [2, 'Bob'],
        [1, 'Alice'],
      ],
    }
    ipc.override('fetch_table_data', () => sortedResponse)

    await useTableDataStore.getState().sortByColumn('tab-1', 'name', 'desc')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.sort).toEqual({ column: 'name', direction: 'desc' })
    expect(tab.rows).toEqual([
      [2, 'Bob'],
      [1, 'Alice'],
    ])
  })

  it('clears sort when direction is null', async () => {
    await setupTabWithData()
    ipc.override('fetch_table_data', () => mockResponse)

    await useTableDataStore.getState().sortByColumn('tab-1', 'name', null)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.sort).toBeNull()
  })
})

describe('useTableDataStore — applyFilters', () => {
  it('sets filter model and fetches page 1', async () => {
    await setupTabWithData()
    ipc.override('fetch_table_data', () => mockResponse)

    const conditions = [{ column: 'name', operator: '==' as const, value: 'Al' }]

    await useTableDataStore.getState().applyFilters('tab-1', conditions)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.filterModel).toEqual(conditions)
  })
})

describe('useTableDataStore — cleanupTab', () => {
  it('removes tab state', async () => {
    await setupTabWithData()
    useTableDataStore.getState().cleanupTab('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1']).toBeUndefined()
  })
})

describe('useTableDataStore — view and UI actions', () => {
  it('setViewMode changes viewMode', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setViewMode('tab-1', 'form')
    expect(useTableDataStore.getState().tabs['tab-1'].viewMode).toBe('form')
  })

  it('setSelectedRow sets and clears selection', async () => {
    await setupTabWithData()
    useTableDataStore.getState().setSelectedRow('tab-1', { id: 1 })
    expect(useTableDataStore.getState().tabs['tab-1'].selectedRowKey).toEqual({ id: 1 })

    useTableDataStore.getState().setSelectedRow('tab-1', null)
    expect(useTableDataStore.getState().tabs['tab-1'].selectedRowKey).toBeNull()
  })

  it('openExportDialog / closeExportDialog toggles flag', async () => {
    await setupTabWithData()
    useTableDataStore.getState().openExportDialog('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1'].isExportDialogOpen).toBe(true)

    useTableDataStore.getState().closeExportDialog('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1'].isExportDialogOpen).toBe(false)
  })
})

describe('useTableDataStore — refreshData', () => {
  it('re-fetches current page', async () => {
    const page2Response: TableDataResponse = {
      ...mockResponse,
      currentPage: 2,
    }
    let callCount = 0
    ipc.override('fetch_table_data', () => {
      callCount++
      if (callCount === 1) return mockResponse
      if (callCount === 2) return page2Response
      return page2Response
    })

    await setupTabWithData()
    // Go to page 2
    await useTableDataStore.getState().fetchPage('tab-1', 2)

    await useTableDataStore.getState().refreshData('tab-1')
    expect(ipc.calls('fetch_table_data').length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Foreign key metadata tests
// ---------------------------------------------------------------------------

describe('useTableDataStore — FK metadata in initTab', () => {
  it('initializes foreignKeys to an empty array', () => {
    useTableDataStore.getState().initTab('tab-fk', 'conn-1', 'mydb', 'users')
    const tab = useTableDataStore.getState().tabs['tab-fk']
    expect(tab.foreignKeys).toEqual([])
  })
})

describe('useTableDataStore — FK metadata in loadTableData', () => {
  it('fetches and stores FK metadata in parallel with table data', async () => {
    const mockFKs: ForeignKeyInfo[] = [
      {
        name: 'fk_user_dept',
        columnName: 'department_id',
        referencedDatabase: 'mydb',
        referencedTable: 'departments',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ]
    ipc.override('get_table_foreign_keys', () => mockFKs)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().loadTableData('tab-1')

    // Wait for the fire-and-forget FK promise to settle
    await vi.waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      expect(tab.foreignKeys).toEqual([
        {
          columnName: 'department_id',
          referencedDatabase: 'mydb',
          referencedTable: 'departments',
          referencedColumn: 'id',
          constraintName: 'fk_user_dept',
        },
      ])
    })

    const fkCalls = ipc.calls('get_table_foreign_keys')
    expect(fkCalls.length).toBeGreaterThan(0)
    const lastCall = fkCalls[fkCalls.length - 1] as Record<string, unknown>
    expect(lastCall?.connectionId).toBe('conn-1')
    expect(lastCall?.database).toBe('mydb')
    expect(lastCall?.table).toBe('users')
  })

  it('filters out composite FKs (same constraintName appearing more than once)', async () => {
    const mockFKs: ForeignKeyInfo[] = [
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
    ipc.override('get_table_foreign_keys', () => mockFKs)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().loadTableData('tab-1')

    await vi.waitFor(() => {
      const tab = useTableDataStore.getState().tabs['tab-1']
      // Only the simple FK should remain; both composite entries excluded
      expect(tab.foreignKeys).toEqual([
        {
          columnName: 'author_id',
          referencedDatabase: 'mydb',
          referencedTable: 'authors',
          referencedColumn: 'id',
          constraintName: 'fk_simple',
        },
      ])
    })
  })

  it('does not block table data loading when FK fetch fails', async () => {
    ipc.override('get_table_foreign_keys', () => {
      throw new Error('FK fetch error')
    })

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().loadTableData('tab-1')

    // Wait for the fire-and-forget FK promise to settle (catch handler)
    await vi.waitFor(() => {
      const logCalls = ipc.calls('log_frontend')
      const hasWarning = logCalls.some(
        (call) =>
          (call as Record<string, unknown>)?.level === 'warn' &&
          String((call as Record<string, unknown>)?.message ?? '').includes(
            'FK metadata fetch failed: FK fetch error'
          )
      )
      expect(hasWarning).toBe(true)
    })

    const tab = useTableDataStore.getState().tabs['tab-1']
    // Table data should still be loaded normally
    expect(tab.columns).toEqual(mockColumns)
    expect(tab.rows).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ])
    expect(tab.error).toBeNull()
    // foreignKeys should remain as empty array
    expect(tab.foreignKeys).toEqual([])
  })

  it('resets foreignKeys to empty array on re-load', async () => {
    const mockFKs: ForeignKeyInfo[] = [
      {
        name: 'fk_user_dept',
        columnName: 'department_id',
        referencedDatabase: 'mydb',
        referencedTable: 'departments',
        referencedColumn: 'id',
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ]
    ipc.override('get_table_foreign_keys', () => mockFKs)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().loadTableData('tab-1')

    // Wait for FK data to be stored
    await vi.waitFor(() => {
      expect(useTableDataStore.getState().tabs['tab-1'].foreignKeys!.length).toBe(1)
    })

    // Now trigger a second load — FK should be temporarily reset to []
    ipc.override('get_table_foreign_keys', () => [])
    await useTableDataStore.getState().loadTableData('tab-1')

    await vi.waitFor(() => {
      expect(useTableDataStore.getState().tabs['tab-1'].foreignKeys).toEqual([])
    })
  })
})

describe('useTableDataStore — TINYINT boolean normalization', () => {
  it('normalizes boolean values to 0/1 when dataType is TINYINT and isBooleanAlias is false', async () => {
    const tinyintColumns: TableDataColumnMeta[] = [
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
        name: 'is_active',
        dataType: 'TINYINT',
        isBooleanAlias: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]

    const responseWithBooleans: TableDataResponse = {
      columns: tinyintColumns,
      rows: [
        [1, true],
        [2, false],
      ],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      executionTimeMs: 10,
    }
    ipc.override('fetch_table_data', () => responseWithBooleans)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'flags')
    await useTableDataStore.getState().fetchPage('tab-1', 1)

    const tab = useTableDataStore.getState().tabs['tab-1']
    // If normalization works, boolean true/false should become 1/0
    expect(tab.rows[0][1]).toBe(1)
    expect(tab.rows[1][1]).toBe(0)
  })

  it('normalizes single-byte control strings to 0/1 for TINYINT display', async () => {
    const tinyintColumns: TableDataColumnMeta[] = [
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
        name: 'is_active',
        dataType: 'TINYINT',
        isBooleanAlias: false,
        isNullable: false,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]

    const responseWithControlStrings: TableDataResponse = {
      columns: tinyintColumns,
      rows: [
        [1, ''],
        [2, ' '],
      ],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      executionTimeMs: 10,
    }
    ipc.override('fetch_table_data', () => responseWithControlStrings)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'flags')
    await useTableDataStore.getState().fetchPage('tab-1', 1)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows[0][1]).toBe(1)
    expect(tab.rows[1][1]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// BIT column value coercion tests
// ---------------------------------------------------------------------------

describe('BIT column value coercion in buildUpdatePayload', () => {
  const bitColumns: TableDataColumnMeta[] = [
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
      name: 'col_bit',
      dataType: 'BIT',
      isBooleanAlias: false,
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: false,
    },
  ]

  it('coerces string "128" to number 128 for BIT columns', () => {
    const result = buildUpdatePayload(
      {
        rowKey: { id: 1 },
        originalValues: { id: 1, col_bit: 0 },
        currentValues: { id: 1, col_bit: '128' },
        modifiedColumns: new Set(['col_bit']),
        isNewRow: false,
      },
      ['id'],
      bitColumns
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.updatedValues.col_bit).toBe(128)
  })

  it('coerces string "0" to number 0 for BIT columns', () => {
    const result = buildUpdatePayload(
      {
        rowKey: { id: 1 },
        originalValues: { id: 1, col_bit: 1 },
        currentValues: { id: 1, col_bit: '0' },
        modifiedColumns: new Set(['col_bit']),
        isNewRow: false,
      },
      ['id'],
      bitColumns
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.updatedValues.col_bit).toBe(0)
  })

  it('passes null through unchanged for BIT columns', () => {
    const result = buildUpdatePayload(
      {
        rowKey: { id: 1 },
        originalValues: { id: 1, col_bit: 1 },
        currentValues: { id: 1, col_bit: null },
        modifiedColumns: new Set(['col_bit']),
        isNewRow: false,
      },
      ['id'],
      bitColumns
    )
    expect(result.ok).toBe(true)
    expect(result.ok ? result.updatedValues.col_bit : 'not-ok').toBeNull()
  })

  it('passes already-numeric values unchanged for BIT columns', () => {
    const result = buildUpdatePayload(
      {
        rowKey: { id: 1 },
        originalValues: { id: 1, col_bit: 0 },
        currentValues: { id: 1, col_bit: 128 },
        modifiedColumns: new Set(['col_bit']),
        isNewRow: false,
      },
      ['id'],
      bitColumns
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.updatedValues.col_bit).toBe(128)
  })

  it('does not coerce string values for non-BIT columns', () => {
    const result = buildUpdatePayload(
      {
        rowKey: { id: 1 },
        originalValues: { id: 1, col_bit: 'old' },
        currentValues: { id: 1, col_bit: '128' },
        modifiedColumns: new Set(['col_bit']),
        isNewRow: false,
      },
      ['id'],
      [bitColumns[0], { ...bitColumns[1], dataType: 'VARCHAR' }]
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.updatedValues.col_bit).toBe('128')
  })
})

describe('BIT column value coercion in buildInsertPayload', () => {
  const bitColumns: TableDataColumnMeta[] = [
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
      name: 'col_bit',
      dataType: 'BIT',
      isBooleanAlias: false,
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isAutoIncrement: false,
    },
  ]

  it('coerces string "128" to number 128 for BIT columns on insert', () => {
    const result = buildInsertPayload(bitColumns, {
      rowKey: { __tempId: 'tmp-1' },
      originalValues: {},
      currentValues: { col_bit: '128' },
      modifiedColumns: new Set(['col_bit']),
      isNewRow: true,
      tempId: 'tmp-1',
    })
    expect(result.col_bit).toBe(128)
  })

  it('coerces string "0" to number 0 for BIT columns on insert', () => {
    const result = buildInsertPayload(bitColumns, {
      rowKey: { __tempId: 'tmp-1' },
      originalValues: {},
      currentValues: { col_bit: '0' },
      modifiedColumns: new Set(['col_bit']),
      isNewRow: true,
      tempId: 'tmp-1',
    })
    expect(result.col_bit).toBe(0)
  })

  it('passes null through unchanged for BIT columns on insert', () => {
    const result = buildInsertPayload(bitColumns, {
      rowKey: { __tempId: 'tmp-1' },
      originalValues: {},
      currentValues: { col_bit: null },
      modifiedColumns: new Set(['col_bit']),
      isNewRow: true,
      tempId: 'tmp-1',
    })
    expect(result.col_bit).toBeNull()
  })

  it('does not coerce string values for non-BIT columns on insert', () => {
    const result = buildInsertPayload([bitColumns[0], { ...bitColumns[1], dataType: 'VARCHAR' }], {
      rowKey: { __tempId: 'tmp-1' },
      originalValues: {},
      currentValues: { col_bit: '128' },
      modifiedColumns: new Set(['col_bit']),
      isNewRow: true,
      tempId: 'tmp-1',
    })
    expect(result.col_bit).toBe('128')
  })
})

describe('useTableDataStore — setCheckedRowKeys', () => {
  it('replaces the checked row keys for the tab', async () => {
    await setupTabWithData('tab-1')
    useTableDataStore.getState().setCheckedRowKeys('tab-1', [{ id: 1 }, { id: 2 }])
    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([
      { id: 1 },
      { id: 2 },
    ])

    useTableDataStore.getState().setCheckedRowKeys('tab-1', [])
    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([])
  })
})

describe('useTableDataStore — deleteRows (bulk)', () => {
  it('deletes multiple persisted rows via IPC and removes them from the grid', async () => {
    const deleteCalls: unknown[] = []
    ipc.override('delete_table_row', (args) => {
      deleteCalls.push(args)
      return undefined
    })

    await setupTabWithData('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1'].rows).toHaveLength(2)

    const deletedCount = await useTableDataStore
      .getState()
      .deleteRows('tab-1', [{ id: 1 }, { id: 2 }])

    expect(deletedCount).toBe(2)
    expect(deleteCalls).toHaveLength(2)
    expect(useTableDataStore.getState().tabs['tab-1'].rows).toHaveLength(0)
  })

  it('returns 0 and performs no IPC when given an empty list', async () => {
    const deleteCalls: unknown[] = []
    ipc.override('delete_table_row', (args) => {
      deleteCalls.push(args)
      return undefined
    })

    await setupTabWithData('tab-1')
    const deletedCount = await useTableDataStore.getState().deleteRows('tab-1', [])

    expect(deletedCount).toBe(0)
    expect(deleteCalls).toHaveLength(0)
    expect(useTableDataStore.getState().tabs['tab-1'].rows).toHaveLength(2)
  })

  it('stops at the first failed delete and records the error', async () => {
    let callCount = 0
    ipc.override('delete_table_row', () => {
      callCount += 1
      if (callCount === 1) return undefined
      throw new Error('FK constraint')
    })

    await setupTabWithData('tab-1')
    const deletedCount = await useTableDataStore
      .getState()
      .deleteRows('tab-1', [{ id: 1 }, { id: 2 }])

    expect(deletedCount).toBe(1)
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.error).toContain('FK constraint')
    // Only the first (successfully deleted) row was removed.
    expect(tab.rows).toHaveLength(1)
  })
})

describe('useTableDataStore — cancelLoad', () => {
  it('does nothing when the tab is not loading', async () => {
    await setupTabWithData('tab-1')
    expect(useTableDataStore.getState().tabs['tab-1'].isLoading).toBe(false)

    await useTableDataStore.getState().cancelLoad('tab-1')

    expect(ipc.calls('cancel_query').length).toBe(0)
    expect(useTableDataStore.getState().tabs['tab-1'].isCancelling).toBe(false)
  })

  it('issues cancel_query and surfaces a cancellation error on the in-flight fetch', async () => {
    let rejectFetch: ((reason: Error) => void) | null = null
    ipc.override(
      'fetch_table_data',
      () =>
        new Promise<TableDataResponse>((_resolve, reject) => {
          rejectFetch = reject
        })
    )
    ipc.override('cancel_query', () => true)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    const fetchPromise = useTableDataStore.getState().fetchPage('tab-1', 1)

    // The fetch is in flight.
    expect(useTableDataStore.getState().tabs['tab-1'].isLoading).toBe(true)

    await useTableDataStore.getState().cancelLoad('tab-1')

    // Cancel was issued for the table-data tab, flag set, success toast shown.
    expect(ipc.calls('cancel_query')).toHaveLength(1)
    expect(ipc.calls('cancel_query')[0]).toMatchObject({
      connectionId: 'conn-1',
      tabId: 'tab-1',
    })
    expect(useTableDataStore.getState().tabs['tab-1'].isCancelling).toBe(true)
    await expectToast('success', 'Query cancelled')

    // The backend KILL surfaces as a query error; report it as a cancellation.
    rejectFetch!(new Error('Data query failed: query execution was interrupted'))
    await fetchPromise

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.error).toBe('Query cancelled by user')
    expect(tab.isLoading).toBe(false)
    expect(tab.isCancelling).toBe(false)
  })

  it('clears isCancelling when no running query is found', async () => {
    let resolveFetch: ((value: TableDataResponse) => void) | null = null
    ipc.override(
      'fetch_table_data',
      () =>
        new Promise<TableDataResponse>((resolve) => {
          resolveFetch = resolve
        })
    )
    // Query already finished server-side: cancel finds nothing to kill.
    ipc.override('cancel_query', () => false)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    const fetchPromise = useTableDataStore.getState().fetchPage('tab-1', 1)

    await useTableDataStore.getState().cancelLoad('tab-1')

    expect(ipc.calls('cancel_query')).toHaveLength(1)
    expect(useTableDataStore.getState().tabs['tab-1'].isCancelling).toBe(false)

    // The fetch still completes normally afterwards.
    resolveFetch!(mockResponse)
    await fetchPromise

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.isLoading).toBe(false)
    expect(tab.error).toBeNull()
  })

  it('does not double-issue cancel while one is already in flight', async () => {
    ipc.override(
      'fetch_table_data',
      () => new Promise<TableDataResponse>(() => {})
    )
    ipc.override('cancel_query', () => true)

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    void useTableDataStore.getState().fetchPage('tab-1', 1)

    await useTableDataStore.getState().cancelLoad('tab-1')
    // Second invocation is a no-op because isCancelling is already set.
    await useTableDataStore.getState().cancelLoad('tab-1')

    expect(ipc.calls('cancel_query')).toHaveLength(1)
  })
})
