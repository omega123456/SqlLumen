import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipc, overrideNamedIpcCommands } from '../ipc-mock'
import {
  useQueryStore,
  isEditableSelectSql,
  DEFAULT_RESULT_STATE,
  type SingleResultState,
} from '../../stores/query-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import type {
  BlobEnvelope,
  PrimaryKeyInfo,
  QueryTableEditInfo,
  TableDataColumnMeta,
  ColumnMeta,
  FilterCondition,
  ResultWindow,
  SetResultViewResult,
} from '../../types/schema'
import {
  flat,
  firstWindowFor,
  makeTabState,
  rowsOf,
  windowedItem,
  windowedResponse,
  withRows,
} from '../helpers/query-test-utils'
import { act } from '@testing-library/react'
import {
  getResultSurface,
  requestVisibleRange,
  seedResultWindow,
} from '../../lib/result-window-cache'

const overrideNamedCommands = overrideNamedIpcCommands

const QUERY_STORE_EDIT_COMMANDS = [
  'analyze_query_for_edit',
  'evict_results',
  'execute_query',
  'insert_table_row',
  'set_result_view',
  'update_result_cell',
  'update_table_row',
] as const

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

const mockBlobEnvelope: BlobEnvelope = {
  __sqllumen_blob__: true,
  kind: 'bytes',
  base64: 'U1FMLUx1bWVu',
}

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

const mockNaturalKeyColumns: TableDataColumnMeta[] = [
  {
    name: 'code',
    dataType: 'VARCHAR',
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

const mockNaturalPk: PrimaryKeyInfo = {
  keyColumns: ['code'],
  hasAutoIncrement: false,
  isUniqueKeyFallback: false,
}

const mockNaturalAnalyzeResult: QueryTableEditInfo[] = [
  {
    database: 'testdb',
    table: 'projects',
    columns: mockNaturalKeyColumns,
    primaryKey: mockNaturalPk,
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

  overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ]),

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
      case 'set_result_view':
        return {
          viewVersion: 2,
          viewRowCount: 2,
          totalRows: 2,
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ]),
        }
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

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
            firstWindow: firstWindowFor([
              [1, 'Alice', 'alice@test.com'],
              [2, 'Bob', 'bob@test.com'],
            ]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1]]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'name', dataType: 'VARCHAR' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([['Alice']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 2]]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'Bob']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com', 101, 1, '99.95']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com', 101, '99.95']]),

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

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([
            [1, 'Alice', '2025-01-01 12:00:00', 101, '2025-01-02 09:30:00'],
          ]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[101]]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[5, 'Alice']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'BIGINT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[5]]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'BIGINT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[5]]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[5, 'Alice']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com', 101, 1, '99.95']]),

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

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1]]),

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
// cloneSelectedRow
// ---------------------------------------------------------------------------

describe('useQueryStore — cloneSelectedRow', () => {
  it('creates one unsaved insert draft with blank primary key values and copied non-key values', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)

    useQueryStore.getState().cloneSelectedRow('tab-1')

    const tab = flat('tab-1')
    // The draft is a virtual row right after the last view row; cached rows are untouched.
    expect(tab.rows).toHaveLength(2)
    expect(tab.selectedRowIndex).toBe(2)
    expect(tab.editingRowIndex).toBe(2)
    expect(tab.editingBaseIndex).toBeNull()
    expect(tab.draftRow).toEqual([null, 'Alice', 'alice@test.com'])
    expect(tab.editState?.isNewRow).toBe(true)
    expect(tab.editState?.rowKey).toEqual({ id: null })
    expect(tab.editState?.originalValues).toEqual({
      id: null,
      name: 'Alice',
      email: 'alice@test.com',
    })
    expect(tab.editState?.currentValues).toEqual({
      id: null,
      name: 'Alice',
      email: 'alice@test.com',
    })
    expect(tab.editState?.modifiedColumns.has('name')).toBe(true)
    expect(tab.editState?.modifiedColumns.has('email')).toBe(true)
    expect(tab.editState?.modifiedColumns.has('id')).toBe(false)
  })

  it('lets the user enter required natural primary-key values after clone without copying them from the source row', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-natural',
          columns: [
            { name: 'code', dataType: 'VARCHAR' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([['p-001', 'Alpha']]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockNaturalAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM projects')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.projects')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')

    let tab = flat('tab-1')
    expect(tab.editState?.currentValues.code).toBeNull()
    expect(tab.editState?.modifiedColumns.has('code')).toBe(false)

    useQueryStore.getState().updateCellValue('tab-1', 0, 'p-002')

    tab = flat('tab-1')
    expect(tab.editState?.currentValues.code).toBe('p-002')
    expect(tab.editState?.modifiedColumns.has('code')).toBe(true)
  })

  it('refuses clone when edit metadata is using a unique-key fallback', async () => {
    const fallbackAnalyzeResult: QueryTableEditInfo[] = [
      {
        ...mockAnalyzeResult[0],
        primaryKey: {
          ...mockPrimaryKey,
          isUniqueKeyFallback: true,
        },
      },
    ]

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-fallback',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com']]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return fallbackAnalyzeResult
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)

    useQueryStore.getState().cloneSelectedRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(1)
    expect(tab.editState).toBeNull()
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.message?.includes('unique-key fallback'))
    ).toBe(true)
  })

  it('refuses clone when current row has unsaved edits that would be lost', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Unsaved')

    const before = flat('tab-1')
    useQueryStore.getState().cloneSelectedRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows).toEqual(before.rows)
    expect(tab.editingRowIndex).toBe(0)
    expect(tab.editState?.isNewRow).toBe(false)
    expect(tab.editState?.currentValues.name).toBe('Unsaved')
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.variant === 'error' && toast.message?.includes('Save or discard')
        )
    ).toBe(true)
  })

  it('does not create a clone draft when no non-primary bound columns can produce an insert payload', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-no-clone-path',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1]]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return [
          {
            database: 'testdb',
            table: 'users',
            columns: [
              {
                name: 'id',
                dataType: 'INT',
                isNullable: false,
                isPrimaryKey: true,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: false,
                isAutoIncrement: true,
                isBooleanAlias: false,
              },
              {
                name: 'server_only',
                dataType: 'VARCHAR',
                isNullable: true,
                isPrimaryKey: false,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: false,
                isAutoIncrement: false,
                isBooleanAlias: false,
              },
            ],
            primaryKey: {
              keyColumns: ['id'],
              hasAutoIncrement: true,
              isUniqueKeyFallback: false,
            },
            foreignKeys: [],
          },
        ]
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT id FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)

    useQueryStore.getState().cloneSelectedRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(1)
    expect(tab.editState).toBeNull()
    expect(tab.selectedRowIndex).toBe(0)
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
})

// ---------------------------------------------------------------------------
// syncCellValue
// ---------------------------------------------------------------------------

describe('useQueryStore — syncCellValue', () => {
  it('updates editState and leaves the cached row untouched (the grid overlays edits)', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Dave')

    const tab = flat('tab-1')
    expect(tab.editState!.currentValues.name).toBe('Dave')
    expect(tab.editState!.modifiedColumns.has('name')).toBe(true)
    // Handed-out cached rows are never mutated while editing.
    expect(tab.rows[0][1]).toBe('Alice')
    expect(tab.editingBaseIndex).toBe(0)
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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ]),

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

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd, args) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com', 101, '99.95']]),

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
        originalPrimaryKeyValues: { id: 1 },
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

  it('starts edit state lazily for bound blob columns and normalizes displayed row values after save', async () => {
    const updateTableRowSpy = vi.fn()
    const updateResultCellSpy = vi.fn()

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd, args) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-blob-save',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'photo', dataType: 'BLOB' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1, 'SGVsbG8=']]),
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return [
          {
            database: 'testdb',
            table: 'users',
            columns: [
              mockTableColumns[0],
              {
                name: 'photo',
                dataType: 'BLOB',
                isBooleanAlias: false,
                isNullable: true,
                isPrimaryKey: false,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: true,
                isAutoIncrement: false,
              },
            ],
            primaryKey: mockPrimaryKey,
            foreignKeys: [],
          },
        ]
      }
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

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)

    useQueryStore.getState().syncCellValue('tab-1', 1, mockBlobEnvelope)

    const staged = flat('tab-1')
    expect(staged.editingRowIndex).toBe(0)
    expect(staged.editState?.originalValues.photo).toBe('SGVsbG8=')
    expect(staged.editState?.currentValues.photo).toEqual(mockBlobEnvelope)
    expect(staged.rows[0][1]).toBe('SGVsbG8=')

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(updateTableRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        originalPrimaryKeyValues: { id: 1 },
        updatedValues: { photo: mockBlobEnvelope },
      })
    )
    // The Rust cache gets the displayed value, never the blob envelope, so a
    // refetch, sort, filter or export reads what the grid shows.
    expect(updateResultCellSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rowIndex: 0,
        queryId: 'q-blob-save',
        updates: { 1: 'U1FMLUx1bWVu' },
      })
    )

    const saved = flat('tab-1')
    expect(saved.editState).toBeNull()
    expect(saved.editingRowIndex).toBeNull()
    expect(saved.rows[0][1]).toBe('U1FMLUx1bWVu')
  })

  it('does not paint a saved row into a result a re-run replaced while the save ran', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-race',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1, 'Alice']]),
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return [
          {
            database: 'testdb',
            table: 'users',
            columns: mockTableColumns.slice(0, 2),
            primaryKey: mockPrimaryKey,
            foreignKeys: [],
          },
        ]
      }
      if (cmd === 'update_result_cell') {
        throw new Error('Results were refreshed during edit')
      }
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Alicia')

    await expect(useQueryStore.getState().saveCurrentRow('tab-1')).resolves.toBe(true)

    expect(flat('tab-1').rows[0][1]).toBe('Alice')
    expect(ipc.payloads('log_frontend')).toContainEqual({
      level: 'info',
      message: expect.stringContaining('saved row not synced into a replaced result'),
    })
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((toast) => toast.title === 'Cache sync warning')).toBe(false)
    expect(toasts.some((toast) => toast.title === 'Row saved')).toBe(true)
  })

  it('inserts a cloned draft through the typed IPC boundary and re-executes the active result', async () => {
    const insertTableRowSpy = vi.fn()
    let executeQueryCount = 0

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd, args) => {
      if (cmd === 'execute_query') {
        executeQueryCount += 1
        if (executeQueryCount === 1) {
          return {
            queryId: 'q-before',
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
              { name: 'email', dataType: 'VARCHAR' },
            ],
            totalRows: 2,
            executionTimeMs: 10,
            affectedRows: 0,
            firstWindow: firstWindowFor([
              [1, 'Alice', 'alice@test.com'],
              [2, 'Bob', 'bob@test.com'],
            ]),

            autoLimitApplied: false,
          }
        }
        return {
          queryId: 'q-after',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 3,
          executionTimeMs: 12,
          affectedRows: 0,
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
            [3, 'Alice', 'alice@test.com'],
          ]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'insert_table_row') {
        insertTableRowSpy(args)
        return [['id', 3]]
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(insertTableRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        database: 'testdb',
        table: 'users',
        values: {
          name: 'Alice',
          email: 'alice@test.com',
        },
      })
    )
    expect(executeQueryCount).toBe(2)

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(3)
    expect(tab.rows[2]).toEqual([3, 'Alice', 'alice@test.com'])
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.selectedRowIndex).toBeNull()
    expect(tab.isStale).toBe(false)
    expect(tab.queryId).toBe('q-after')
  })

  it('keeps generated primary keys out of the insert payload but includes user-entered natural keys', async () => {
    const insertTableRowSpy = vi.fn()
    let executeQueryCount = 0

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd, args) => {
      if (cmd === 'execute_query') {
        executeQueryCount += 1
        if (executeQueryCount === 1) {
          return {
            queryId: 'q-natural-before',
            columns: [
              { name: 'code', dataType: 'VARCHAR' },
              { name: 'name', dataType: 'VARCHAR' },
            ],
            totalRows: 1,
            executionTimeMs: 10,
            affectedRows: 0,
            firstWindow: firstWindowFor([['p-001', 'Alpha']]),

            autoLimitApplied: false,
          }
        }
        return {
          queryId: 'q-natural-after',
          columns: [
            { name: 'code', dataType: 'VARCHAR' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          totalRows: 2,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([
            ['p-001', 'Alpha'],
            ['p-002', 'Alpha'],
          ]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockNaturalAnalyzeResult
      if (cmd === 'insert_table_row') {
        insertTableRowSpy(args)
        return [['code', 'p-002']]
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM projects')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.projects')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')
    useQueryStore.getState().updateCellValue('tab-1', 0, 'p-002')

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    expect(insertTableRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          code: 'p-002',
          name: 'Alpha',
        },
      })
    )
    expect(executeQueryCount).toBe(2)
  })

  it('includes cloned non-primary-key blob values in insert payload even when not inline editable', async () => {
    const insertTableRowSpy = vi.fn()

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd, args) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-blob-before',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'avatar_blob', dataType: 'BLOB' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1, 'Alice', '0xABCD']]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return [
          {
            database: 'testdb',
            table: 'users',
            columns: [
              { ...mockTableColumns[0] },
              { ...mockTableColumns[1] },
              {
                name: 'avatar_blob',
                dataType: 'BLOB',
                isBooleanAlias: false,
                isNullable: true,
                isPrimaryKey: false,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: true,
                isAutoIncrement: false,
              },
            ],
            primaryKey: mockPrimaryKey,
            foreignKeys: [],
          },
        ]
      }
      if (cmd === 'insert_table_row') {
        insertTableRowSpy(args)
        return [['id', 2]]
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    await flushMicrotasks()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')

    const cloned = flat('tab-1')
    expect(cloned.draftRow).toEqual([null, 'Alice', '0xABCD'])

    await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(insertTableRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          name: 'Alice',
          avatar_blob: '0xABCD',
        },
      })
    )
  })

  it('marks the previous result stale and clears the clone draft when refresh fails after a successful insert', async () => {
    let executeQueryCount = 0

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        executeQueryCount += 1
        if (executeQueryCount > 1) {
          throw new Error('Refresh failed')
        }
        return {
          queryId: 'q-before-stale',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 2,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'insert_table_row') return [['id', 3]]
      if (cmd === 'evict_results') return null
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')

    const result = await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(result).toBe(true)
    const tab = flat('tab-1')
    expect(tab.rows).toEqual([
      [1, 'Alice', 'alice@test.com'],
      [2, 'Bob', 'bob@test.com'],
    ])
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.selectedRowIndex).toBeNull()
    expect(tab.isStale).toBe(true)
    expect(tab.queryId).toBe('q-before-stale')
    expect(tab.saveError).toBeNull()
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.variant === 'error' && toast.message?.includes('could not be refreshed')
        )
    ).toBe(true)
  })

  it('discards stale single-result insert refresh responses when queryId changes during await', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let resolveRefresh: (value: unknown) => void = () => {
      throw new Error('Expected delayed refresh resolver to be captured')
    }
    let executeQueryCount = 0

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        executeQueryCount += 1
        if (executeQueryCount === 1) {
          return {
            queryId: 'q-initial',
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
              { name: 'email', dataType: 'VARCHAR' },
            ],
            totalRows: 2,
            executionTimeMs: 10,
            affectedRows: 0,
            firstWindow: firstWindowFor([
              [1, 'Alice', 'alice@test.com'],
              [2, 'Bob', 'bob@test.com'],
            ]),

            autoLimitApplied: false,
          }
        }

        if (executeQueryCount === 2) {
          return new Promise((resolve) => {
            resolveRefresh = resolve
          })
        }

        return {
          queryId: 'q-newer',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          totalRows: 1,
          executionTimeMs: 8,
          affectedRows: 0,
          firstWindow: firstWindowFor([[9, 'Latest', 'latest@test.com']]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'insert_table_row') return [['id', 3]]
      if (cmd === 'evict_results') return null
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')

    const savePromise = useQueryStore.getState().saveCurrentRow('tab-1')
    await flushMicrotasks()
    await useQueryStore
      .getState()
      .executeQuery('conn-1', 'tab-1', 'SELECT * FROM users WHERE id = 9')

    resolveRefresh({
      queryId: 'q-late-refresh',
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
        { name: 'email', dataType: 'VARCHAR' },
      ],
      totalRows: 3,
      executionTimeMs: 15,
      affectedRows: 0,
      firstWindow: firstWindowFor([
        [1, 'Alice', 'alice@test.com'],
        [2, 'Bob', 'bob@test.com'],
        [3, 'Cloned', 'alice@test.com'],
      ]),
      autoLimitApplied: false,
    })
    await savePromise

    const tab = flat('tab-1')
    expect(tab.queryId).toBe('q-newer')
    expect(tab.rows).toEqual([[9, 'Latest', 'latest@test.com']])
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
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

    // The edit lives in editState only; the cached row is untouched.
    expect(flat('tab-1').editState?.currentValues.name).toBe('Modified')
    expect(flat('tab-1').rows[0][1]).toBe('Alice')

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.rows[0][1]).toBe('Alice') // restored
  })

  it('restores the correct aliased joined column on discard', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'alice@test.com', 101, '99.95']]),

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

    expect(flat('tab-1').editState?.modifiedColumns.size).toBe(1)
    expect(flat('tab-1').rows[0][0]).toBe(1)

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows[0][0]).toBe(1)
    expect(tab.rows[0][3]).toBe(101)
  })

  it('restores original blob display values on discard after a lazy blob edit', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-blob-discard',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'photo', dataType: 'BLOB' },
          ],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1, 'SGVsbG8=']]),
          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') {
        return [
          {
            database: 'testdb',
            table: 'users',
            columns: [
              mockTableColumns[0],
              {
                name: 'photo',
                dataType: 'BLOB',
                isBooleanAlias: false,
                isNullable: true,
                isPrimaryKey: false,
                isUniqueKey: false,
                hasDefault: false,
                columnDefault: null,
                isBinary: true,
                isAutoIncrement: false,
              },
            ],
            primaryKey: mockPrimaryKey,
            foreignKeys: [],
          },
        ]
      }
      if (cmd === 'evict_results') return null
      return null
    })

    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)

    useQueryStore.getState().syncCellValue('tab-1', 1, mockBlobEnvelope)
    expect(flat('tab-1').editState?.currentValues.photo).toEqual(mockBlobEnvelope)

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.rows[0][1]).toBe('SGVsbG8=')
  })

  it('removes a cloned draft without changing the source row', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().setSelectedRow('tab-1', 0)
    useQueryStore.getState().cloneSelectedRow('tab-1')
    useQueryStore.getState().syncCellValue('tab-1', 1, 'Clone Only')

    expect(flat('tab-1').rows).toHaveLength(2)
    expect(flat('tab-1').draftRow?.[1]).toBe('Clone Only')

    useQueryStore.getState().discardCurrentRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows).toEqual([
      [1, 'Alice', 'alice@test.com'],
      [2, 'Bob', 'bob@test.com'],
    ])
    expect(tab.editState).toBeNull()
    expect(tab.editingRowIndex).toBeNull()
    expect(tab.selectedRowIndex).toBeNull()
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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-dml',
          columns: [], // no columns — DML
          totalRows: 0,
          executionTimeMs: 5,
          affectedRows: 3,
          firstWindow: firstWindowFor([]),
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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1]]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') throw new Error('Analysis failed')
      if (cmd === 'evict_results') return null
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    await flushMicrotasks()

    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()

    const tab = flat('tab-1')
    expect(tab.isAnalyzingQuery).toBe(false)
    expect(Object.keys(tab.editTableMetadata)).toEqual([])
    // Query should still be successful
    expect(tab.resultStatus).toBe('success')
  })

  it('does not analyze for SHOW/DESCRIBE/EXPLAIN even when columns are returned', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-show',
          columns: [{ name: 'Tables_in_db', dataType: 'VARCHAR' }],
          totalRows: 3,
          executionTimeMs: 5,
          affectedRows: 0,
          firstWindow: firstWindowFor([['users'], ['orders'], ['products']]),

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
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-' + Math.random(),
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstWindow: firstWindowFor([[1]]),

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
})

// ---------------------------------------------------------------------------
// changeRowLimit — clears edit state before re-execution
// ---------------------------------------------------------------------------

describe('useQueryStore — changeRowLimit clears edit state', () => {
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

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-1', 500)
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
  it('clearing a sort keeps edit mode but drops the editing row (no re-run)', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Changed')

    // Verify edit state is active
    const before = flat('tab-1')
    expect(before.editMode).toBe('testdb.users')
    expect(before.editState).not.toBeNull()

    await useQueryStore.getState().sortResults('tab-1', 'id', null)
    await flushMicrotasks()

    const after = flat('tab-1')
    expect(after.editMode).toBe('testdb.users')
    expect(after.editableColumnMap.size).toBeGreaterThan(0)
    expect(after.editState).toBeNull()
    expect(after.editingRowIndex).toBeNull()
    expect(after.editingBaseIndex).toBeNull()
    expect(after.resultStatus).toBe('success')
    expect(ipc.payloads('execute_query')).toHaveLength(1)
  })

  it('does not clear edit state for normal sort (asc/desc)', async () => {
    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
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
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ]),

          autoLimitApplied: false,
        }
      }
      if (cmd === 'analyze_query_for_edit') return mockAnalyzeResult
      if (cmd === 'set_result_view') {
        return {
          viewVersion: 2,
          viewRowCount: 2,
          totalRows: 2,
          firstWindow: firstWindowFor([
            [1, 'Alice', 'alice@test.com'],
            [2, 'Bob', 'bob@test.com'],
          ]),
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
    await useQueryStore.getState().sortResults('tab-1', 'id', 'asc')

    const after = flat('tab-1')
    expect(after.editMode).toBe('testdb.users')
    expect(after.editableColumnMap.size).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// insertDraftRow
// ---------------------------------------------------------------------------

describe('useQueryStore — insertDraftRow', () => {
  it('opens an empty insert draft right after the last view row', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')

    useQueryStore.getState().insertDraftRow('tab-1')

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(2)
    expect(tab.draftRow).toEqual([null, null, null])
    expect(tab.selectedRowIndex).toBe(2)
    expect(tab.editingRowIndex).toBe(2)
    expect(tab.editingBaseIndex).toBeNull()
    expect(tab.editState?.isNewRow).toBe(true)
    expect(tab.editState?.modifiedColumns.size).toBe(0)
  })

  it('inserts the values typed into the draft when saved', async () => {
    ipc.override('insert_table_row', () => [['id', 3]])
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().insertDraftRow('tab-1')
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Carol')
    useQueryStore.getState().updateCellValue('tab-1', 2, 'carol@test.com')

    await useQueryStore.getState().saveCurrentRow('tab-1')

    expect(ipc.payloads('insert_table_row')[0]).toMatchObject({
      database: 'testdb',
      table: 'users',
      values: { name: 'Carol', email: 'carol@test.com' },
    })
  })

  it('refuses with a toast while another row has unsaved changes', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode('conn-1', 'tab-1', 'testdb.users')
    useQueryStore.getState().startEditingRow('tab-1', 0)
    useQueryStore.getState().updateCellValue('tab-1', 1, 'Alicia')

    useQueryStore.getState().insertDraftRow('tab-1')

    expect(flat('tab-1').draftRow).toBeNull()
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((toast) => toast.title === 'Unsaved changes')).toBe(true)
  })

  it('does nothing when edit mode is not enabled', async () => {
    await executeAndAnalyze()

    useQueryStore.getState().insertDraftRow('tab-1')

    expect(flat('tab-1').draftRow).toBeNull()
    expect(flat('tab-1').editState).toBeNull()
  })
})

describe('result view filter and sort', () => {
  /**
   * Sort and filter run in Rust over a view of the cached result. The store only
   * sends view specs (`set_result_view`) and paints the returned first window.
   *
   * Covers the compare-and-swap protocol (D15): request sequence numbers, the
   * latest known view version, at most one re-issue after `view_superseded`,
   * and the terminal rule (revert + "Couldn't apply sort or filter" band).
   * Filter operator semantics are covered by the Rust view tests.
   */

  const TAB = 'tab-1'
  const CONN = 'conn-1'

  const COLUMNS: ColumnMeta[] = [
    { name: 'id', dataType: 'INT' },
    { name: 'name', dataType: 'VARCHAR' },
    { name: 'age', dataType: 'INT' },
  ]

  const ROWS: unknown[][] = [
    [1, 'Alice', 30],
    [2, 'Bob', 25],
    [3, 'Charlie', 35],
  ]

  const FILTER_A: FilterCondition[] = [{ column: 'age', operator: '>', value: '26' }]

  function windowOf(rows: unknown[][], baseIndices: number[]): ResultWindow {
    return { offset: 0, rows, baseIndices }
  }

  function viewResponse(
    viewVersion: number,
    rows: unknown[][],
    baseIndices: number[],
    totalRows = ROWS.length
  ): SetResultViewResult {
    return {
      viewVersion,
      viewRowCount: rows.length,
      totalRows,
      firstWindow: windowOf(rows, baseIndices),
    }
  }

  interface Pending {
    args: Record<string, unknown>
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }

  /** Queue `set_result_view` calls so a test can settle them in any order. */
  function deferSetResultView(): Pending[] {
    const pending: Pending[] = []
    ipc.overridePayload(
      'set_result_view',
      (args) =>
        new Promise((resolve, reject) => {
          pending.push({ args: args ?? {}, resolve, reject })
        })
    )
    return pending
  }

  function result() {
    return useQueryStore.getState().tabs[TAB]!.results[0]
  }

  async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    act(() => {
      useQueryStore.setState({
        tabs: {
          [TAB]: makeTabState({
            connectionId: CONN,
            status: 'success',
            columns: COLUMNS,
            rows: ROWS,
            queryId: 'q-1',
            viewVersion: 1,
            lastExecutedSql: 'SELECT * FROM people',
            selectedRowIndex: 1,
            checkedRowIndices: [0],
          }),
        },
      })
    })
  })

  describe('applyQueryFilters', () => {
    it('sends the whole view spec with the latest known version and paints the first window', async () => {
      ipc.override('set_result_view', () => viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))

      await act(async () => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
        expect(result().isFiltering).toBe(true)
        await flush()
      })

      expect(ipc.payloads('set_result_view')[0]).toEqual({
        connectionId: CONN,
        tabId: TAB,
        resultIndex: 0,
        queryId: 'q-1',
        baseViewVersion: 1,
        viewSpec: { sort: null, filters: FILTER_A },
      })
      const painted = result()
      expect(painted.isFiltering).toBe(false)
      expect(painted.filterModel).toEqual(FILTER_A)
      expect(painted.viewVersion).toBe(2)
      expect(painted.viewRowCount).toBe(2)
      expect(painted.totalRows).toBe(3)
      expect(rowsOf(TAB)).toEqual([ROWS[0], ROWS[2]])
      // Checked rows and the selection belong to the old view.
      expect(painted.checkedRanges).toEqual([])
      expect(painted.checkedViewVersion).toBe(2)
      expect(painted.selectedRowIndex).toBeNull()
      expect(ipc.payloads('execute_query')).toHaveLength(0)
    })

    it('keeps the current sort when filtering', async () => {
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [TAB]: {
              ...state.tabs[TAB]!,
              results: [{ ...result(), sortColumn: 'name', sortDirection: 'desc' }],
            },
          },
        }))
      })
      ipc.override('set_result_view', () => viewResponse(2, [ROWS[2]], [2]))

      await act(async () => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
        await flush()
      })

      expect(ipc.payloads('set_result_view')[0]).toMatchObject({
        viewSpec: { sort: { column: 'name', direction: 'desc' }, filters: FILTER_A },
      })
      expect(result().sortColumn).toBe('name')
    })

    it('clearing filters restores the unfiltered view in Rust without a re-run', async () => {
      ipc.override('set_result_view', () => viewResponse(3, ROWS, [0, 1, 2]))

      await act(async () => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, [])
        await flush()
      })

      expect(ipc.payloads('set_result_view')[0]).toMatchObject({
        viewSpec: { sort: null, filters: [] },
      })
      expect(result().filterModel).toEqual([])
      expect(rowsOf(TAB)).toEqual(ROWS)
      expect(ipc.payloads('execute_query')).toHaveLength(0)
      expect(ipc.payloads('reexecute_single_result')).toHaveLength(0)
    })

    it('ignores an out-of-range result index', () => {
      useQueryStore.getState().applyQueryFilters(TAB, 5, FILTER_A)
      useQueryStore.getState().applyQueryFilters('missing', 0, FILTER_A)
      expect(ipc.payloads('set_result_view')).toHaveLength(0)
    })
  })

  describe('sortResults', () => {
    it('shows the sorting overlay while the view request is pending', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'id', 'asc')
      })
      expect(result().isSorting).toBe(true)
      await act(async () => {
        pending[0].resolve(viewResponse(2, ROWS, [0, 1, 2]))
        await sortPromise
      })
      expect(result().isSorting).toBe(false)
    })

    it('discards a response for a result that was replaced meanwhile', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'id', 'asc')
      })
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [TAB]: { ...state.tabs[TAB]!, results: [{ ...result(), queryId: 'q-new' }] },
          },
        }))
      })
      await act(async () => {
        pending[0].resolve(viewResponse(9, [ROWS[2]], [2]))
        await sortPromise
      })
      expect(result().viewVersion).toBe(1)
      expect(result().sortColumn).toBeNull()
    })
  })

  describe('overlapping view changes (D15)', () => {
    it('an older success updates the latest known version; a superseded newer request is re-issued once and painted', async () => {
      const pending = deferSetResultView()

      // Filter A (seq 1) and sort B (seq 2) both start from version 1.
      act(() => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'name', 'asc')
      })
      expect(pending.map((call) => call.args.baseViewVersion)).toEqual([1, 1])
      expect(pending[1].args.viewSpec).toEqual({
        sort: { column: 'name', direction: 'asc' },
        filters: FILTER_A,
      })

      // A wins the compare-and-swap: not painted (older sequence), but its version is kept.
      await act(async () => {
        pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
        await flush()
      })
      expect(result().latestKnownViewVersion).toBe(2)
      expect(result().viewVersion).toBe(1)
      expect(result().filterModel).toEqual([])

      // B is refused against the old version and re-issued once against <n>.
      await act(async () => {
        pending[1].reject(new Error('view_superseded: current=2'))
        await flush()
      })
      expect(pending).toHaveLength(3)
      expect(pending[2].args.baseViewVersion).toBe(2)

      await act(async () => {
        pending[2].resolve(viewResponse(3, [ROWS[0], ROWS[2]], [0, 2]))
        await sortPromise
      })
      const painted = result()
      expect(painted.viewVersion).toBe(3)
      expect(painted.sortColumn).toBe('name')
      expect(painted.filterModel).toEqual(FILTER_A)
      expect(painted.viewError).toBeNull()

      // Window fetches keep working against the painted version.
      ipc.overridePayload('fetch_result_window', (args) => ({
        offset: args?.offset,
        rows: [],
        baseIndices: [],
        viewRowCount: 2,
        viewVersion: 3,
      }))
      expect(getResultSurface(TAB, 0)?.viewVersion).toBe(3)
    })

    it('a second refusal reverts to the latest successful view and shows the view-error band', async () => {
      const pending = deferSetResultView()
      act(() => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'name', 'asc')
      })
      await act(async () => {
        pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
        pending[1].reject(new Error('view_superseded: current=2'))
        await flush()
      })
      await act(async () => {
        pending[2].reject(new Error('view_superseded: current=2'))
        await sortPromise
      })

      // No automatic re-issue after the second refusal.
      expect(pending).toHaveLength(3)
      const reverted = result()
      expect(reverted.viewVersion).toBe(2)
      expect(reverted.filterModel).toEqual(FILTER_A)
      expect(reverted.sortColumn).toBeNull()
      expect(reverted.viewError).toBe('view_superseded: current=2')
      expect(reverted.isSorting).toBe(false)
      expect(rowsOf(TAB)).toEqual([ROWS[0], ROWS[2]])
      expect(
        useToastStore.getState().toasts.some((t) => t.title === "Couldn't apply sort or filter")
      ).toBe(true)
    })

    it('a newer request failing with a non-superseded error reverts to the latest success without re-issuing', async () => {
      const pending = deferSetResultView()
      act(() => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'missing', 'asc')
      })
      await act(async () => {
        pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
        pending[1].reject(new Error("Sort column 'missing' not found"))
        await sortPromise
      })

      expect(pending).toHaveLength(2)
      expect(result().viewVersion).toBe(2)
      expect(result().filterModel).toEqual(FILTER_A)
      expect(result().viewError).toBe("Sort column 'missing' not found")
    })

    it('with no successful view, keeps the server view and refetches it when its version moved on', async () => {
      const pending = deferSetResultView()
      ipc.override('fetch_result_window', () => ({
        offset: 0,
        rows: [ROWS[1]],
        baseIndices: [1],
        viewRowCount: 1,
        viewVersion: 4,
      }))
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'id', 'asc')
      })
      await act(async () => {
        pending[0].reject(new Error('view_superseded: current=4'))
        await flush()
      })
      await act(async () => {
        pending[1].reject(new Error('view_superseded: current=4'))
        await sortPromise
      })

      expect(ipc.payloads('fetch_result_window')[0]).toMatchObject({ viewVersion: 4, offset: 0 })
      expect(result().viewVersion).toBe(4)
      expect(result().viewError).toBe('view_superseded: current=4')
      expect(rowsOf(TAB)).toEqual([ROWS[1]])
    })

    it('with no successful view and no newer version, only shows the band', async () => {
      ipc.override('set_result_view', () => {
        throw new Error('boom')
      })
      await act(async () => {
        await useQueryStore.getState().sortResults(TAB, 'id', 'asc')
      })
      expect(result().viewVersion).toBe(1)
      expect(result().sortColumn).toBeNull()
      expect(result().viewError).toBe('boom')
      expect(rowsOf(TAB)).toEqual(ROWS)
    })

    it('keeps the band when refetching the server view also fails', async () => {
      const pending = deferSetResultView()
      ipc.override('fetch_result_window', () => {
        throw new Error('offline')
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'id', 'asc')
      })
      await act(async () => {
        pending[0].reject(new Error('view_superseded: current=4'))
        await flush()
        pending[1].reject(new Error('view_superseded: current=4'))
        await sortPromise
      })
      expect(result().viewError).toBe('view_superseded: current=4')
      expect(result().isSorting).toBe(false)
    })

    it('a success older than a tombstone write repaints the server view with its spec', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'name', 'desc')
      })
      // Meanwhile a delete tombstoned row 1 on top of the sorted view (v3) and painted.
      act(() => {
        useQueryStore.setState((state) => {
          const tab = state.tabs[TAB]!
          return {
            tabs: {
              ...state.tabs,
              [TAB]: {
                ...tab,
                results: [{ ...tab.results[0], viewVersion: 3, latestKnownViewVersion: 3 }],
              },
            },
          }
        })
      })
      ipc.override('fetch_result_window', () => ({
        offset: 0,
        rows: [ROWS[2], ROWS[0]],
        baseIndices: [2, 0],
        viewRowCount: 2,
        viewVersion: 3,
      }))
      await act(async () => {
        pending[0].resolve(viewResponse(2, [ROWS[2], ROWS[1], ROWS[0]], [2, 1, 0]))
        await sortPromise
      })

      // v2 is never painted: its windows would all be view_stale.
      expect(ipc.payloads('fetch_result_window')[0]).toMatchObject({
        viewVersion: 3,
        offset: 0,
        limit: 1000,
      })
      const painted = result()
      expect(painted.viewVersion).toBe(3)
      expect(painted.sortColumn).toBe('name')
      expect(painted.sortDirection).toBe('desc')
      expect(painted.isSorting).toBe(false)
      expect(painted.viewError).toBeNull()
      expect(rowsOf(TAB)).toEqual([ROWS[2], ROWS[0]])
    })

    it('settles with the view-error band when repainting the server view fails', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore.getState().sortResults(TAB, 'name', 'desc')
      })
      act(() => {
        useQueryStore.setState((state) => {
          const tab = state.tabs[TAB]!
          return {
            tabs: {
              ...state.tabs,
              [TAB]: { ...tab, results: [{ ...tab.results[0], latestKnownViewVersion: 3 }] },
            },
          }
        })
      })
      ipc.override('fetch_result_window', () => {
        throw new Error('offline')
      })
      await act(async () => {
        pending[0].resolve(viewResponse(2, ROWS, [0, 1, 2]))
        await sortPromise
      })
      expect(result().isSorting).toBe(false)
      expect(result().viewError).toBe('offline')
    })

    it('Retry re-issues the latest requested spec', async () => {
      ipc.override('set_result_view', () => {
        throw new Error('boom')
      })
      await act(async () => {
        useQueryStore.getState().applyQueryFilters(TAB, 0, FILTER_A)
        await flush()
      })
      expect(result().viewError).toBe('boom')

      ipc.override('set_result_view', () => viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
      await act(async () => {
        useQueryStore.getState().retryViewChange(TAB)
        await flush()
      })
      expect(ipc.payloads('set_result_view')[1]).toMatchObject({
        viewSpec: { sort: null, filters: FILTER_A },
      })
      expect(result().viewError).toBeNull()
      expect(result().filterModel).toEqual(FILTER_A)
    })

    it('retryViewChange is a no-op for unknown tabs', () => {
      useQueryStore.getState().retryViewChange('missing')
      expect(ipc.payloads('set_result_view')).toHaveLength(0)
    })
  })

  describe('window retry', () => {
    it('retryResultWindow clears the failed range and refetches it', async () => {
      ipc.override('fetch_result_window', () => {
        throw new Error('offline')
      })
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [TAB]: { ...state.tabs[TAB]!, results: [{ ...result(), viewRowCount: 3000 }] },
          },
        }))
      })
      // A larger view than the seeded rows: positions past the first window aren't loaded.
      useQueryStore.setState((state) => state)
      const surface = getResultSurface(TAB, 0)
      expect(surface).toBeDefined()
      await act(async () => {
        requestVisibleRange(TAB, 0, [3, 3])
        await flush()
      })
      act(() => {
        useQueryStore.getState().retryResultWindow(TAB)
      })
      expect(result().failedWindowRange).toBeNull()
    })
  })
})

describe('windowed results', () => {
  /**
   * Windowed query results in the store:
   * - every re-run path passes the current view spec, so the first window comes
   *   back already sorted and filtered in one execute call (D18);
   * - a saved edit under a sort and filter targets the row's base index and
   *   patches the page cache (the view version doesn't change).
   */

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
            runExport: null,
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

      expect(ipc.payloads('execute_query')).toHaveLength(1)
      expect(ipc.payloads('execute_query')[0]).toMatchObject({
        rowLimit: 50,
        viewSpec: EXPECTED_SPEC,
      })
      expect(ipc.payloads('set_result_view')).toHaveLength(0)
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

      expect(ipc.payloads('reexecute_single_result')[0]).toMatchObject({
        resultIndex: 0,
        rowLimit: 25,
        viewSpec: EXPECTED_SPEC,
      })
      expect(ipc.payloads('set_result_view')).toHaveLength(0)
      expect(rowsOf(TAB, 0)).toEqual(RERUN_WINDOW_ROWS)
    })

    it('omits the view spec when the result has no sort or filter', async () => {
      setTab([{ ...SORTED_FILTERED, sortColumn: null, sortDirection: null, filterModel: [] }])
      ipc.override('execute_query', () => windowedResponse({ columns: COLUMNS }))

      await act(async () => {
        await useQueryStore.getState().changeRowLimit(CONN, TAB, 10)
      })

      expect('viewSpec' in (ipc.payloads('execute_query')[0] as Record<string, unknown>)).toBe(
        false
      )
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

      expect(ipc.payloads('execute_query')).toHaveLength(1)
      expect(ipc.payloads('execute_query')[0]).toMatchObject({ viewSpec: EXPECTED_SPEC })
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

      expect(ipc.payloads('insert_table_row')).toHaveLength(1)
      expect(ipc.payloads('execute_query')[0]).toMatchObject({ viewSpec: EXPECTED_SPEC })
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

      expect(ipc.payloads('update_table_row')[0]).toMatchObject({
        originalPrimaryKeyValues: { id: 1 },
      })
      expect(ipc.payloads('update_result_cell')[0]).toMatchObject({
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
})
