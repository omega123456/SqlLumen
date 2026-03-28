import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { TableDataResponse, PrimaryKeyInfo, TableDataColumnMeta } from '../../types/schema'

// Mock the IPC commands module
vi.mock('../../lib/table-data-commands', () => ({
  fetchTableData: vi.fn(),
  updateTableRow: vi.fn(),
  insertTableRow: vi.fn(),
  deleteTableRow: vi.fn(),
  exportTableData: vi.fn(),
}))

import { useTableDataStore } from '../../stores/table-data-store'
import {
  fetchTableData,
  updateTableRow,
  insertTableRow,
  deleteTableRow,
} from '../../lib/table-data-commands'

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
  totalRows: 2,
  currentPage: 1,
  totalPages: 1,
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
  useTableDataStore.setState({ tabs: {} })
  vi.clearAllMocks()
  ;(fetchTableData as Mock).mockResolvedValue(mockResponse)
  ;(updateTableRow as Mock).mockResolvedValue(undefined)
  ;(insertTableRow as Mock).mockResolvedValue([
    ['id', 3],
    ['name', 'Charlie'],
  ])
  ;(deleteTableRow as Mock).mockResolvedValue(undefined)
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
    expect(tab.totalRows).toBe(0)
    expect(tab.currentPage).toBe(1)
    expect(tab.totalPages).toBe(0)
    expect(tab.pageSize).toBe(1000)
    expect(tab.primaryKey).toBeNull()
    expect(tab.executionTimeMs).toBe(0)
    expect(tab.editState).toBeNull()
    expect(tab.viewMode).toBe('grid')
    expect(tab.selectedRowKey).toBeNull()
    expect(tab.filterModel).toEqual({})
    expect(tab.sort).toBeNull()
    expect(tab.isLoading).toBe(false)
    expect(tab.error).toBeNull()
    expect(tab.saveError).toBeNull()
    expect(tab.isExportDialogOpen).toBe(false)
    expect(tab.pendingNavigationAction).toBeNull()
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
    expect(tab.totalRows).toBe(2)
    expect(tab.primaryKey).toEqual(mockPrimaryKey)
    expect(tab.isLoading).toBe(false)
    expect(tab.error).toBeNull()
    expect(fetchTableData).toHaveBeenCalledTimes(1)
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
    ;(fetchTableData as Mock).mockResolvedValueOnce(mockResponse)
    ;(fetchTableData as Mock).mockResolvedValueOnce(page2Response)

    await setupTabWithData()
    await useTableDataStore.getState().fetchPage('tab-1', 2)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([
      [3, 'Charlie'],
      [4, 'Dave'],
    ])
    expect(tab.currentPage).toBe(2)
    expect(fetchTableData).toHaveBeenCalledTimes(2)
  })

  it('sets error on IPC failure', async () => {
    ;(fetchTableData as Mock).mockRejectedValue(new Error('Fetch failed'))

    useTableDataStore.getState().initTab('tab-1', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().fetchPage('tab-1', 1)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.error).toBe('Fetch failed')
    expect(tab.isLoading).toBe(false)
  })

  it('skips state update if tab was cleaned up during fetch', async () => {
    let resolvePromise: ((value: TableDataResponse) => void) | null = null
    ;(fetchTableData as Mock).mockReturnValue(
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
    ;(fetchTableData as Mock).mockResolvedValueOnce({
      columns: booleanAliasColumns,
      rows: [[1, true]],
      totalRows: 1,
      currentPage: 1,
      totalPages: 1,
      pageSize: 1000,
      primaryKey: mockPrimaryKey,
      executionTimeMs: 12,
    })

    useTableDataStore.getState().initTab('tab-bool', 'conn-1', 'mydb', 'users')
    await useTableDataStore.getState().fetchPage('tab-bool', 1)

    expect(useTableDataStore.getState().tabs['tab-bool'].rows).toEqual([[1, 1]])
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
})

describe('useTableDataStore — saveCurrentRow (UPDATE path)', () => {
  it('calls updateTableRow with original PK values and updates row on success', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Updated')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    expect(updateTableRow).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      primaryKeyColumns: ['id'],
      originalPkValues: { id: 1 },
      updatedValues: { name: 'Updated' },
    })

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    expect(tab.saveError).toBeNull()
    // Row should be updated in the rows array
    expect(tab.rows[0]).toEqual([1, 'Updated'])
  })

  it('sets saveError on failure (does NOT clear editState)', async () => {
    ;(updateTableRow as Mock).mockRejectedValue(new Error('Update failed'))

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

    expect(updateTableRow).not.toHaveBeenCalled()
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

    expect(insertTableRow).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      values: expect.objectContaining({ name: 'Charlie' }),
      pkInfo: mockPrimaryKey,
    })

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.editState).toBeNull()
    // The temp row should be replaced with the returned data
    expect(tab.rows[tab.rows.length - 1]).toEqual([3, 'Charlie'])
    expect(tab.totalRows).toBe(3) // incremented
  })

  it('normalizes boolean alias cells when replacing temp row after insert', async () => {
    ;(insertTableRow as Mock).mockResolvedValueOnce([
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
          totalRows: 0,
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

  it('sets saveError on insert failure', async () => {
    ;(insertTableRow as Mock).mockRejectedValue(new Error('Insert failed'))

    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Charlie')

    await useTableDataStore.getState().saveCurrentRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.saveError).toBe('Insert failed')
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.isNewRow).toBe(true)
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

  it('selects the temp row when inserting a new row', async () => {
    await setupTabWithData()

    useTableDataStore.getState().insertNewRow('tab-1')

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.selectedRowKey).toEqual({ __tempId: tab.editState!.tempId })
  })
})

describe('useTableDataStore — deleteRow (existing row)', () => {
  it('calls deleteTableRow IPC and removes from rows', async () => {
    await setupTabWithData()

    await useTableDataStore.getState().deleteRow('tab-1', { id: 1 }, { id: 1, name: 'Alice' })

    expect(deleteTableRow).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'mydb',
      table: 'users',
      pkColumns: ['id'],
      pkValues: { id: 1 },
    })

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.rows).toEqual([[2, 'Bob']])
    expect(tab.totalRows).toBe(1)
  })
})

describe('useTableDataStore — deleteRow (new row)', () => {
  it('removes from rows WITHOUT IPC call', async () => {
    await setupTabWithData()
    useTableDataStore.getState().insertNewRow('tab-1')
    const tempId = useTableDataStore.getState().tabs['tab-1'].editState!.tempId!
    const rowCountBefore = useTableDataStore.getState().tabs['tab-1'].rows.length

    await useTableDataStore
      .getState()
      .deleteRow('tab-1', { __tempId: tempId }, { id: null, name: null })

    expect(deleteTableRow).not.toHaveBeenCalled()
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

    expect(updateTableRow).toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
    expect(useTableDataStore.getState().tabs['tab-1'].pendingNavigationAction).toBeNull()
  })

  it('keeps pendingNavigationAction if save fails', async () => {
    ;(updateTableRow as Mock).mockRejectedValue(new Error('Save failed'))

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

    expect(updateTableRow).not.toHaveBeenCalled()
    // editState should remain
    expect(useTableDataStore.getState().tabs['tab-1'].editState).not.toBeNull()
  })

  it('calls saveCurrentRow with different row key', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    useTableDataStore.getState().updateCellValue('tab-1', 'name', 'Modified')

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 2 })

    expect(updateTableRow).toHaveBeenCalled()
    // editState should be cleared on success
    expect(useTableDataStore.getState().tabs['tab-1'].editState).toBeNull()
  })

  it('sets saveError on failure, editState remains on original row', async () => {
    ;(updateTableRow as Mock).mockRejectedValue(new Error('Commit failed'))

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

    expect(updateTableRow).not.toHaveBeenCalled()
  })

  it('does nothing when no modifications', async () => {
    await setupTabWithData()
    useTableDataStore.getState().startEditing('tab-1', { id: 1 }, { id: 1, name: 'Alice' })
    // Don't modify anything

    await useTableDataStore.getState().commitEditingRowIfNeeded('tab-1', { id: 2 })

    expect(updateTableRow).not.toHaveBeenCalled()
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
    ;(fetchTableData as Mock).mockResolvedValueOnce(sortedResponse)

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
    ;(fetchTableData as Mock).mockResolvedValueOnce(mockResponse)

    await useTableDataStore.getState().sortByColumn('tab-1', 'name', null)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.sort).toBeNull()
  })
})

describe('useTableDataStore — applyFilters', () => {
  it('sets filter model and fetches page 1', async () => {
    await setupTabWithData()
    ;(fetchTableData as Mock).mockResolvedValueOnce(mockResponse)

    const filterModel = {
      name: { filterType: 'text', type: 'contains', filter: 'Al' },
    }

    await useTableDataStore.getState().applyFilters('tab-1', filterModel)

    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab.filterModel).toEqual(filterModel)
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
    ;(fetchTableData as Mock).mockResolvedValueOnce(mockResponse)
    ;(fetchTableData as Mock).mockResolvedValueOnce(page2Response)
    ;(fetchTableData as Mock).mockResolvedValueOnce(page2Response)

    await setupTabWithData()
    // Go to page 2
    await useTableDataStore.getState().fetchPage('tab-1', 2)

    await useTableDataStore.getState().refreshData('tab-1')
    expect(fetchTableData).toHaveBeenCalledTimes(3)
  })
})
