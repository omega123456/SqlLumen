import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  useQueryStore,
  isEditableSelectSql,
  getFlatTabState,
  DEFAULT_RESULT_STATE,
} from '../../stores/query-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import type { QueryTableEditInfo, TableDataColumnMeta, PrimaryKeyInfo } from '../../types/schema'

/** Shorthand: get a flat (tab + active result) view for assertions. */
function flat(tabId: string) {
  return getFlatTabState(useQueryStore.getState().getTabState(tabId))
}

/**
 * Patch result-level fields on an existing tab's results[0].
 * Works for tabs populated by executeQuery (which creates results[0]).
 */
function patchResult(tabId: string, resultOverrides: Record<string, unknown>) {
  useQueryStore.setState((prev) => {
    const tab = prev.tabs[tabId]!
    const existingResult = tab.results[0] ?? { ...DEFAULT_RESULT_STATE }
    return {
      tabs: {
        ...prev.tabs,
        [tabId]: {
          ...tab,
          results: [{ ...existingResult, ...resultOverrides }],
          activeResultIndex: 0,
        },
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockTableColumns: TableDataColumnMeta[] = [
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
  {
    name: 'email',
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

const mockOrderColumns: TableDataColumnMeta[] = [
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
    name: 'user_id',
    dataType: 'INT',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'total',
    dataType: 'DECIMAL',
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

const mockOrderPrimaryKey: PrimaryKeyInfo = {
  keyColumns: ['id'],
  hasAutoIncrement: true,
  isUniqueKeyFallback: false,
}

const mockAnalyzeResult: QueryTableEditInfo[] = [
  {
    database: 'testdb',
    table: 'users',
    columns: mockTableColumns,
    primaryKey: mockPrimaryKey,
    foreignKeys: [],
  },
]

const mockJoinAnalyzeResult: QueryTableEditInfo[] = [
  ...mockAnalyzeResult,
  {
    database: 'testdb',
    table: 'orders',
    columns: mockOrderColumns,
    primaryKey: mockOrderPrimaryKey,
    foreignKeys: [],
  },
]

/** Flush microtasks so fire-and-forget promises complete. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  _resetToastTimeoutsForTests()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'execute_query':
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 2,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ],
          totalPages: 1,
          autoLimitApplied: false,
        }
      case 'analyze_query_for_edit':
        return mockAnalyzeResult
      case 'update_table_row':
        return null
      case 'update_result_cell':
        return null
      case 'evict_results':
        return null
      default:
        return null
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Helper: execute a query and wait for background analysis to complete.
 */
async function executeAndAnalyze(connId = 'conn-1', tabId = 'tab-1') {
  await useQueryStore.getState().executeQuery(connId, tabId, 'SELECT * FROM users')
  await flushMicrotasks()
}

// ---------------------------------------------------------------------------
// setEditMode
// ---------------------------------------------------------------------------

describe('useQueryStore — setEditMode', () => {
  it('enables edit mode for a valid table', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const f = flat('tab-1')
    expect(f.editMode).toBe('testdb.users')
    expect(f.editableColumnMap.size).toBeGreaterThan(0)
    expect(f.editConnectionId).toBe('conn-1')
    expect(f.editState).toBeNull()
  })

  it('maps single-column foreign keys into editForeignKeys when enabling edit mode', async () => {
    const analyzeWithForeignKeys: QueryTableEditInfo[] = [
      {
        ...mockAnalyzeResult[0],
        foreignKeys: [
          {
            name: 'fk_users_email',
            columnName: 'email',
            referencedDatabase: 'testdb',
            referencedTable: 'accounts',
            referencedColumn: 'id',
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
        ],
      },
    ]

    mockIPC((cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-mock',
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
              { name: 'email', dataType: 'VARCHAR' },
            ],
            totalRows: 2,
            executionTimeMs: 10,
            affectedRows: 0,
            firstPage: [
              [1, 'Alice', 'alice@test.com'],
              [2, 'Bob', 'bob@test.com'],
            ],
            totalPages: 1,
            autoLimitApplied: false,
          }
        case 'analyze_query_for_edit':
          return analyzeWithForeignKeys
        case 'update_table_row':
        case 'update_result_cell':
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editForeignKeys).toEqual([
      {
        columnName: 'email',
        referencedDatabase: 'testdb',
        referencedTable: 'accounts',
        referencedColumn: 'id',
        constraintName: 'fk_users_email',
      },
    ])
  })

  it('disables edit mode when tableName is null', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', null)

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editableColumnMap.size).toBe(0)
    expect(tab.editColumnBindings.size).toBe(0)
    expect(tab.editBoundColumnIndexMap.size).toBe(0)
    expect(tab.editConnectionId).toBeNull()
  })

  it('shows error toast when table metadata is not available', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return [] // no tables detected
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'somedb.nonexistent')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.message?.includes('nonexistent'))).toBe(
      true
    )
  })

  it('shows error toast when PK columns are missing from result', async () => {
    // Result has 'name' but not 'id' — PK column missing
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'name', dataType: 'VARCHAR' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [['Alice']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult // table has PK on 'id'
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT name FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()

    const toasts = useToastStore.getState().toasts
    expect(
      toasts.some((t) => t.variant === 'error' && t.message?.includes('unique key columns'))
    ).toBe(true)
  })

  it('shows error toast when PK columns are ambiguous', async () => {
    // Result has duplicate 'id' columns
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'id', dataType: 'INT' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 2]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery('conn-1', 'tab-1', 'SELECT * FROM users JOIN orders')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()

    const toasts = useToastStore.getState().toasts
    const errorToasts = toasts.filter((t) => t.variant === 'error')
    // Should have either the "missing key" or "ambiguous key" error
    expect(errorToasts.length).toBeGreaterThan(0)
  })

  it('shows warning toast for ambiguous non-key columns but enables editing', async () => {
    // Result has duplicate 'name' (non-key) but 'id' (key) is fine
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 'Bob']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBe('testdb.users') // editing is enabled

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'warning' && t.message?.includes('ambiguous'))).toBe(
      true
    )
  })

  it('enables edit mode for joined SELECT * results when the selected table key is duplicated by another table', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'id', dataType: 'INT' },
            { name: 'user_id', dataType: 'INT' },
            { name: 'total', dataType: 'DECIMAL' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 'alice@test.com', 101, 1, '99.95']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockJoinAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT users.*, orders.* FROM users JOIN orders ON users.id = orders.user_id'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    let tab = flat('tab-1')
    expect(tab.editMode).toBe('testdb.users')

    useQueryStore.getState().startEditingRow('tab-1', 0)
    tab = flat('tab-1')
    expect(tab.editState?.rowKey).toEqual({ id: 1 })
    expect(tab.editState?.originalValues).toMatchObject({
      id: 1,
      name: 'Alice',
      email: 'alice@test.com',
    })
  })

  it('enables edit mode when joined key columns are aliased in the query result', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'user_id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'order_id', dataType: 'INT' },
            { name: 'total', dataType: 'DECIMAL' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 'alice@test.com', 101, '99.95']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockJoinAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT users.id AS user_id, users.name, users.email, orders.id AS order_id, orders.total FROM users JOIN orders ON users.id = orders.user_id'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    let tab = flat('tab-1')
    expect(tab.editMode).toBe('testdb.users')

    useQueryStore.getState().startEditingRow('tab-1', 0)
    tab = flat('tab-1')
    expect(tab.editState?.rowKey).toEqual({ id: 1 })
    expect(tab.editState?.originalValues).toMatchObject({
      id: 1,
      name: 'Alice',
      email: 'alice@test.com',
    })
  })

  it('does not warn about ambiguous non-key columns when explicit bindings disambiguate the selected table column', async () => {
    const usersWithCreatedAt: TableDataColumnMeta[] = [
      ...mockTableColumns,
      {
        name: 'created_at',
        dataType: 'DATETIME',
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
    const ordersWithCreatedAt: TableDataColumnMeta[] = [
      ...mockOrderColumns,
      {
        name: 'created_at',
        dataType: 'DATETIME',
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
    const analyzeResultWithCreatedAt: QueryTableEditInfo[] = [
      {
        database: 'testdb',
        table: 'users',
        columns: usersWithCreatedAt,
        primaryKey: mockPrimaryKey,
        foreignKeys: [],
      },
      {
        database: 'testdb',
        table: 'orders',
        columns: ordersWithCreatedAt,
        primaryKey: mockOrderPrimaryKey,
        foreignKeys: [],
      },
    ]

    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'created_at', dataType: 'DATETIME' },
            { name: 'id', dataType: 'INT' },
            { name: 'created_at', dataType: 'DATETIME' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', '2025-01-01 12:00:00', 101, '2025-01-02 09:30:00']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return analyzeResultWithCreatedAt
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT users.id, users.name, users.created_at, orders.id, orders.created_at FROM users JOIN orders ON users.id = orders.user_id'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBe('testdb.users')
    expect(tab.editableColumnMap.get(2)).toBe(true)

    const warnings = useToastStore
      .getState()
      .toasts.filter(
        (toast) => toast.variant === 'warning' && toast.message?.includes('created_at')
      )
    expect(warnings).toHaveLength(0)
  })

  it('does not enable edit mode when only another joined table contributes the key column name', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[101]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockJoinAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT orders.id FROM users JOIN orders ON users.id = orders.user_id'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editColumnBindings.size).toBe(0)
  })

  it('does not enable edit mode when an expression aliases itself to a key column name', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'BIGINT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[5, 'Alice']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery('conn-1', 'tab-1', 'SELECT COUNT(*) AS id, users.name FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editColumnBindings.size).toBe(0)
    expect(
      useToastStore.getState().toasts.some((t) => t.message?.includes('unique key columns'))
    ).toBe(true)
  })

  it('does not enable edit mode for single-table expression aliases that mimic key columns', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'BIGINT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[5]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery('conn-1', 'tab-1', 'SELECT COUNT(*) AS id FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editColumnBindings.size).toBe(0)
  })

  it('does not enable edit mode for expression aliases without AS that mimic key columns', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'BIGINT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[5]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT id + 1 id FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editColumnBindings.size).toBe(0)
  })

  it('does not enable edit mode for unresolved wildcard subquery projections', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'BIGINT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[5, 'Alice']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT x.* FROM (SELECT COUNT(*) AS id, MAX(name) AS name FROM users) x'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editColumnBindings.size).toBe(0)
  })

  it('uses cached metadata on second call', async () => {
    let analyzeCallCount = 0
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        analyzeCallCount++
        return mockAnalyzeResult
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    await flushMicrotasks()

    // First call populates from background analysis
    const countBefore = analyzeCallCount

    // Disable then re-enable
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    const countAfterFirst = analyzeCallCount

    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', null)
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    const countAfterSecond = analyzeCallCount

    // setEditMode should find cached metadata (from background analysis in executeQuery)
    // so no additional calls beyond background + possibly the first setEditMode call
    // The key assertion: the second setEditMode doesn't trigger a new analyze call
    expect(countAfterSecond).toBe(countAfterFirst)

    // But ensure the metadata survived disable/enable
    // After disable, editTableMetadata is cleared. After re-enable, setEditMode calls analyze again.
    // Actually, disable calls patchTab with editTableMetadata not cleared (only editMode, editableColumnMap, etc.)
    // Let me verify: The setEditMode(null) only clears specific fields, not editTableMetadata.
    // So the metadata should still be cached.
    expect(countAfterFirst).toBe(countBefore) // background already populated it
  })

  it('enables joined edit mode on the first attempt without waiting for background analysis', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'id', dataType: 'INT' },
            { name: 'user_id', dataType: 'INT' },
            { name: 'total', dataType: 'DECIMAL' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 'alice@test.com', 101, 1, '99.95']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockJoinAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT users.*, orders.* FROM users JOIN orders ON users.id = orders.user_id'
      )

    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBe('testdb.users')
  })

  it('shows error toast when no primary key exists', async () => {
    const noPkResult: QueryTableEditInfo[] = [
      {
        database: 'testdb',
        table: 'users',
        columns: mockTableColumns,
        primaryKey: null,
        foreignKeys: [],
      },
    ]

    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return noPkResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.message?.includes('no primary'))).toBe(
      true
    )
  })
})

// ---------------------------------------------------------------------------
// startEditingRow
// ---------------------------------------------------------------------------

describe('useQueryStore — startEditingRow', () => {
  it('creates edit state for the specified row', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)

    const tab = flat('tab-1')
    expect(tab.editState).not.toBeNull()
    expect(tab.editState!.rowKey).toEqual({ id: 1 })
    expect(tab.editState!.originalValues.name).toBe('Alice')
    expect(tab.editState!.modifiedColumns.size).toBe(0)
    expect(tab.editingRowIndex).toBe(0)
  })

  it('does nothing when edit mode is not enabled', async () => {
    await executeAndAnalyze()
    useQueryStore.getState().startEditingRow('tab-1', 0)

    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateCellValue
// ---------------------------------------------------------------------------

describe('useQueryStore — updateCellValue', () => {
  it('updates currentValues and modifiedColumns', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Charlie')

    const tab = flat('tab-1')
    expect(tab.editState!.currentValues.name).toBe('Charlie')
    expect(tab.editState!.modifiedColumns.has('name')).toBe(true)
  })

  it('removes from modifiedColumns when value reverts to original', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)

    useQueryStore.getState().updateCellValue('tab-1', 1, 'Charlie')
    expect(flat('tab-1').editState!.modifiedColumns.has('name')).toBe(true)

    useQueryStore.getState().updateCellValue('tab-1', 1, 'Alice')
    expect(flat('tab-1').editState!.modifiedColumns.has('name')).toBe(false)
  })

  it('does nothing when no editState', async () => {
    await executeAndAnalyze()
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Charlie')
    // Should not throw
    expect(flat('tab-1').editState).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// syncCellValue
// ---------------------------------------------------------------------------

describe('useQueryStore — syncCellValue', () => {
  it('updates editState and local row data', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Dave')

    const tab = flat('tab-1')
    expect(tab.editState!.currentValues.name).toBe('Dave')
    expect(tab.editState!.modifiedColumns.has('name')).toBe(true)
    // Local row data should also be updated
    expect(tab.rows[0][1]).toBe('Dave') // name is column index 1
  })

  it('removes from modifiedColumns when value reverts to original', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)

    useQueryStore.getState().syncCellValue('tab-1', 1, 'Changed')
    expect(flat('tab-1').editState!.modifiedColumns.has('name')).toBe(true)

    // Revert to original value
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Alice')
    expect(flat('tab-1').editState!.modifiedColumns.has('name')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveCurrentRow
// ---------------------------------------------------------------------------

describe('useQueryStore — saveCurrentRow', () => {
  it('calls updateTableRow and clears editState on success, returns true', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Updated')

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.saveError).toBeNull()
    // Verify local row was updated
    expect(tab.rows[0][1]).toBe('Updated')
  })

  it('shows a success toast when row is saved successfully', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Saved Value')

    await useQueryStore.getState().saveCurrentRow('tab-1')

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'success' && t.title === 'Row saved')).toBe(true)
  })

  it('sets saveError and shows toast on IPC failure, returns false', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 2,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'update_table_row') throw new Error('Duplicate entry')
      if (cmd === 'evict_results') return null
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Updated')

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(false)
    const tab = flat('tab-1')
    expect(tab.saveError).toContain('Duplicate entry')
    expect(tab.editState).not.toBeNull() // edit state preserved on failure

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.title === 'Save failed')).toBe(true)
  })

  it('clears editState without IPC when nothing is modified, returns true', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)

    // No updateCellValue — nothing modified
    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
  })

  it('shows error when table metadata has no primary key, returns false', async () => {
    await executeAndAnalyze()

    // Manually patch the cached metadata to have no PK
    const tab = flat('tab-1')
    patchResult('tab-1', {
      editMode: 'testdb.users',
      editConnectionId: 'conn-1',
      editingRowIndex: 0,
      editTableMetadata: {
        'testdb.users': {
          ...tab.editTableMetadata['testdb.users'],
          primaryKey: null,
        },
      },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Changed' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(false)
    const tabAfter = flat('tab-1')
    expect(tabAfter.saveError).toBe('No primary key info available')

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.title === 'Save failed')).toBe(true)
  })

  it('saves aliased joined columns using bound source names and result indexes', async () => {
    const updateTableRowSpy = vi.fn()
    const updateResultCellSpy = vi.fn()

    mockIPC((cmd, args) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'user_id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'order_id', dataType: 'INT' },
            { name: 'total', dataType: 'DECIMAL' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 'alice@test.com', 101, '99.95']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockJoinAnalyzeResult
      if (cmd === 'update_table_row') {
        updateTableRowSpy(args)
        return null
      }
      if (cmd === 'update_result_cell') {
        updateResultCellSpy(args)
        return null
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT users.id AS user_id, users.name, users.email, orders.id AS order_id, orders.total FROM users JOIN orders ON users.id = orders.user_id'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 0, 5)

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(updateTableRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        originalPkValues: { id: 1 },
        updatedValues: { id: 5 },
      })
    )
    expect(updateResultCellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 0,
        updates: { 0: 5 },
      })
    )

    const tab = flat('tab-1')
    expect(tab.rows[0][0]).toBe(5)
    expect(tab.rows[0][3]).toBe(101)
  })
})

// ---------------------------------------------------------------------------
// discardCurrentRow
// ---------------------------------------------------------------------------

describe('useQueryStore — discardCurrentRow', () => {
  it('restores original values in local row data', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Modified')

    // Verify the row was modified
    expect(flat('tab-1').rows[0][1]).toBe('Modified')

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.rows[0][1]).toBe('Alice') // restored
  })

  it('restores the correct aliased joined column on discard', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'user_id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
            { name: 'order_id', dataType: 'INT' },
            { name: 'total', dataType: 'DECIMAL' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1, 'Alice', 'alice@test.com', 101, '99.95']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockJoinAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore
      .getState()
      .executeQuery(
        'conn-1',
        'tab-1',
        'SELECT users.id AS user_id, users.name, users.email, orders.id AS order_id, orders.total FROM users JOIN orders ON users.id = orders.user_id'
      )
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 0, 5)

    expect(flat('tab-1').rows[0][0]).toBe(5)

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows[0][0]).toBe(1)
    expect(tab.rows[0][3]).toBe(101)
  })

  it('does nothing when no editState', async () => {
    await executeAndAnalyze()
    useQueryStore.getState().discardCurrentRow('tab-1')
    // Should not throw
  })

  it('clears editState when editingRowIndex is null', async () => {
    await executeAndAnalyze()

    // Manually set editState but with null editingRowIndex
    patchResult('tab-1', {
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Changed' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
      editingRowIndex: null,
    })

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// requestNavigationAction
// ---------------------------------------------------------------------------

describe('useQueryStore — requestNavigationAction', () => {
  it('executes action immediately when no pending edits', async () => {
    await executeAndAnalyze()
    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction('tab-1', action)
    expect(action).toHaveBeenCalledOnce()
  })

  it('executes immediately and clears editState when editState has no modifications', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    // No modifications

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction('tab-1', action)
    expect(action).toHaveBeenCalledOnce()

    // Edit state should be discarded since dataset is changing
    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
  })

  it('defers action when there are pending edits', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction('tab-1', action)
    expect(action).not.toHaveBeenCalled()
    expect(useQueryStore.getState().getTabState('tab-1').pendingNavigationAction).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// confirmNavigation
// ---------------------------------------------------------------------------

describe('useQueryStore — confirmNavigation', () => {
  it('saves and executes pending action when shouldSave is true', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Saved')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction('tab-1', action)
    expect(action).not.toHaveBeenCalled()

    await useQueryStore.getState().confirmNavigation('tab-1', true)
    expect(action).toHaveBeenCalledOnce()
    expect(useQueryStore.getState().getTabState('tab-1').pendingNavigationAction).toBeNull()
  })

  it('discards and executes pending action when shouldSave is false', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Discardable')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction('tab-1', action)

    await useQueryStore.getState().confirmNavigation('tab-1', false)
    expect(action).toHaveBeenCalledOnce()
    expect(flat('tab-1').rows[0][1]).toBe('Alice') // restored
  })
})

// ---------------------------------------------------------------------------
// cancelNavigation
// ---------------------------------------------------------------------------

describe('useQueryStore — cancelNavigation', () => {
  it('clears pendingNavigationAction', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction('tab-1', action)
    useQueryStore.getState().cancelNavigation('tab-1')

    expect(useQueryStore.getState().getTabState('tab-1').pendingNavigationAction).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// clearEditState
// ---------------------------------------------------------------------------

describe('useQueryStore — clearEditState', () => {
  it('resets all edit-related fields to defaults', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    useQueryStore.getState().clearEditState('tab-1')

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editState).toBeNull()
    expect(tab.editableColumnMap.size).toBe(0)
    expect(tab.editTableMetadata).toEqual({})
    expect(tab.isAnalyzingQuery).toBe(false)
    expect(tab.saveError).toBeNull()
    expect(tab.editConnectionId).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
  })

  it('is called when executeQuery runs', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    // Verify edit state is active
    expect(flat('tab-1').editMode).toBe('testdb.users')

    // Execute a new query
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    await flushMicrotasks()

    const tab = flat('tab-1')
    expect(tab.editMode).toBeNull()
    expect(tab.editState).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// executeQuery — background analysis
// ---------------------------------------------------------------------------

describe('useQueryStore — executeQuery background analysis', () => {
  it('populates editTableMetadata after successful query with columns', async () => {
    await executeAndAnalyze()

    const tab = flat('tab-1')
    const tables = Object.values(tab.editTableMetadata)
    expect(tables).toHaveLength(1)
    expect(tables[0].table).toBe('users')
    expect(tab.editTableMetadata['testdb.users']).toBeDefined()
    expect(tab.isAnalyzingQuery).toBe(false)
  })

  it('does not analyze for DML results (no columns)', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-dml',
          columns: [], // no columns — DML
          totalRows: 0,
          executionTimeMs: 5,
          affectedRows: 3,
          firstPage: [],
          totalPages: 0,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        throw new Error('Should not be called for DML')
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'DELETE FROM users')
    await flushMicrotasks()

    const tab = flat('tab-1')
    expect(Object.keys(tab.editTableMetadata)).toEqual([])
  })

  it('handles analysis failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') throw new Error('Analysis failed')
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    await flushMicrotasks()

    expect(consoleSpy).toHaveBeenCalledWith(
      '[query-edit] analyze_query_for_edit failed:',
      expect.any(Error)
    )
    consoleSpy.mockRestore()

    const tab = flat('tab-1')
    expect(tab.isAnalyzingQuery).toBe(false)
    expect(Object.keys(tab.editTableMetadata)).toEqual([])
    // Query should still be successful
    expect(tab.resultStatus).toBe('success')
  })

  it('does not analyze for SHOW/DESCRIBE/EXPLAIN even when columns are returned', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-show',
          columns: [{ name: 'Tables_in_db', dataType: 'VARCHAR' }],
          totalRows: 3,
          executionTimeMs: 5,
          affectedRows: 0,
          firstPage: [['users'], ['orders'], ['products']],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        throw new Error('Should not be called for SHOW')
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SHOW TABLES')
    await flushMicrotasks()

    const tab = flat('tab-1')
    expect(Object.keys(tab.editTableMetadata)).toEqual([])
    expect(tab.isAnalyzingQuery).toBe(false)
    expect(tab.resultStatus).toBe('success')
  })

  it('discards stale analysis when queryId has changed', async () => {
    let analysisResolve: ((tables: unknown[]) => void) | null = null
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-' + Math.random(),
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        // Return a promise that we control
        return new Promise((resolve) => {
          analysisResolve = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    // Execute first query — analysis starts
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    const firstResolve = analysisResolve!
    // Clear analysisResolve so second executeQuery produces a new one
    analysisResolve = null // eslint-disable-line no-useless-assignment

    // Execute second query — new analysis starts, queryId changes
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM orders')

    // Now resolve the FIRST analysis — it should be discarded because queryId changed
    firstResolve(mockAnalyzeResult)
    await flushMicrotasks()

    // The metadata should either be empty (from second query whose analysis hasn't resolved)
    // or from the second query — never from the first
    const tab = flat('tab-1')
    // First query's analysis should have been discarded
    expect(Object.keys(tab.editTableMetadata)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getTabState — new defaults
// ---------------------------------------------------------------------------

describe('useQueryStore — getTabState default edit fields', () => {
  it('returns default edit fields for unknown tab', () => {
    const state = flat('unknown')
    expect(state.editMode).toBeNull()
    expect(state.editTableMetadata).toEqual({})
    expect(state.editState).toBeNull()
    expect(state.isAnalyzingQuery).toBe(false)
    expect(state.editableColumnMap).toBeInstanceOf(Map)
    expect(state.editableColumnMap.size).toBe(0)
    expect(state.pendingNavigationAction).toBeNull()
    expect(state.saveError).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// isEditableSelectSql
// ---------------------------------------------------------------------------

describe('isEditableSelectSql', () => {
  it('returns true for SELECT queries', () => {
    expect(isEditableSelectSql('SELECT * FROM users')).toBe(true)
    expect(isEditableSelectSql('  select id from t')).toBe(true)
    expect(isEditableSelectSql('SELECT 1')).toBe(true)
  })

  it('returns true for WITH (CTE) queries', () => {
    expect(isEditableSelectSql('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
    expect(isEditableSelectSql('  with RECURSIVE cte AS (...) SELECT ...')).toBe(true)
  })

  it('returns false for SHOW/DESCRIBE/EXPLAIN', () => {
    expect(isEditableSelectSql('SHOW TABLES')).toBe(false)
    expect(isEditableSelectSql('DESCRIBE users')).toBe(false)
    expect(isEditableSelectSql('DESC users')).toBe(false)
    expect(isEditableSelectSql('EXPLAIN SELECT * FROM users')).toBe(false)
  })

  it('returns false for DML/DDL', () => {
    expect(isEditableSelectSql('INSERT INTO users VALUES (1)')).toBe(false)
    expect(isEditableSelectSql('UPDATE users SET name = "foo"')).toBe(false)
    expect(isEditableSelectSql('DELETE FROM users')).toBe(false)
    expect(isEditableSelectSql('CREATE TABLE t (id INT)')).toBe(false)
    expect(isEditableSelectSql('DROP TABLE t')).toBe(false)
  })

  it('returns false for null/empty', () => {
    expect(isEditableSelectSql(null)).toBe(false)
    expect(isEditableSelectSql('')).toBe(false)
    expect(isEditableSelectSql('  ')).toBe(false)
  })

  it('returns true for SELECT with leading block comments', () => {
    expect(isEditableSelectSql('/* note */ SELECT * FROM users')).toBe(true)
    expect(isEditableSelectSql('/* a */ /* b */ SELECT 1')).toBe(true)
    expect(isEditableSelectSql('  /* spaced */ SELECT id FROM t')).toBe(true)
  })

  it('returns true for SELECT with leading line comments (-- style)', () => {
    expect(isEditableSelectSql('-- comment\nSELECT * FROM users')).toBe(true)
    expect(isEditableSelectSql('-- a\n-- b\nSELECT 1')).toBe(true)
  })

  it('returns true for SELECT with leading # comments', () => {
    expect(isEditableSelectSql('# comment\nSELECT * FROM users')).toBe(true)
    expect(isEditableSelectSql('# a\n# b\nSELECT 1')).toBe(true)
  })

  it('returns true for SELECT with mixed leading comments', () => {
    expect(isEditableSelectSql('/* block */ -- line\nSELECT 1')).toBe(true)
    expect(isEditableSelectSql('-- line\n/* block */ SELECT 1')).toBe(true)
    expect(isEditableSelectSql('# hash\n/* block */ SELECT 1')).toBe(true)
  })

  it('returns true for SELECT with nested block comments', () => {
    expect(isEditableSelectSql('/* outer /* inner */ still outer */ SELECT 1')).toBe(true)
  })

  it('returns false for non-SELECT with leading comments', () => {
    expect(isEditableSelectSql('/* note */ SHOW TABLES')).toBe(false)
    expect(isEditableSelectSql('-- comment\nINSERT INTO t VALUES (1)')).toBe(false)
    expect(isEditableSelectSql('# hash\nUPDATE t SET x = 1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveCurrentRow — return value for no-op cases
// ---------------------------------------------------------------------------

describe('useQueryStore — saveCurrentRow return value edge cases', () => {
  it('returns true when no editState exists', async () => {
    await executeAndAnalyze()
    // No edit mode enabled — no editState
    const result = await useQueryStore.getState().saveCurrentRow('tab-1')
    expect(result).toBe(true)
  })

  it('returns true for unknown tab', async () => {
    const result = await useQueryStore.getState().saveCurrentRow('nonexistent')
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// changePageSize — clears edit state before re-execution
// ---------------------------------------------------------------------------

describe('useQueryStore — changePageSize clears edit state', () => {
  it('clears edit mode, editableColumnMap, editTableMetadata, editState, and editingRowIndex', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    // Verify edit state is active
    const before = flat('tab-1')
    expect(before.editMode).toBe('testdb.users')
    expect(before.editState).not.toBeNull()
    expect(before.editableColumnMap.size).toBeGreaterThan(0)
    expect(Object.keys(before.editTableMetadata).length).toBeGreaterThan(0)
    expect(before.editingRowIndex).toBe(0)

    await useQueryStore.getState().changePageSize('conn-1', 'tab-1', 500)
    await flushMicrotasks()

    const after = flat('tab-1')
    expect(after.editMode).toBeNull()
    expect(after.editState).toBeNull()
    expect(after.editableColumnMap.size).toBe(0)
    expect(after.editColumnBindings.size).toBe(0)
    expect(after.editBoundColumnIndexMap.size).toBe(0)
    // editTableMetadata is cleared then repopulated by background analysis
    // After flushMicrotasks it should be repopulated
    expect(after.editingRowIndex).toBeNull()
    expect(after.resultStatus).toBe('success')
  })
})

// ---------------------------------------------------------------------------
// sortResults (sort-clear) — clears edit state before re-execution
// ---------------------------------------------------------------------------

describe('useQueryStore — sortResults sort-clear clears edit state', () => {
  it('clears edit state when sort direction is null (sort-clear)', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    // Verify edit state is active
    const before = flat('tab-1')
    expect(before.editMode).toBe('testdb.users')
    expect(before.editState).not.toBeNull()

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)
    await flushMicrotasks()

    const after = flat('tab-1')
    expect(after.editMode).toBeNull()
    expect(after.editState).toBeNull()
    expect(after.editableColumnMap.size).toBe(0)
    expect(after.editColumnBindings.size).toBe(0)
    expect(after.editBoundColumnIndexMap.size).toBe(0)
    expect(after.editingRowIndex).toBeNull()
    expect(after.resultStatus).toBe('success')
  })

  it('does not clear edit state for normal sort (asc/desc)', async () => {
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 2,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'sort_results') {
        return {
          rows: [
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ],
          page: 1,
          totalPages: 1,
        }
      }
      if (cmd === 'evict_results') return null
      if (cmd === 'update_table_row') return null
      if (cmd === 'update_result_cell') return null
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    // Normal sort (asc) should not clear edit mode
    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')

    const after = flat('tab-1')
    expect(after.editMode).toBe('testdb.users')
    expect(after.editableColumnMap.size).toBeGreaterThan(0)
  })
})
