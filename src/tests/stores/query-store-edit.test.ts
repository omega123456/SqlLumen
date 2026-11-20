import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  useQueryStore,
  isEditableSelectSql,
  activeQuerySurfaceRef,
  querySurfaceRef,
  type SingleResultState,
} from '../../stores/query-store'
import { useToastStore } from '../../stores/toast-store'
import { retryViewChange, retryWindow } from '../../stores/data-view/view-actions'
import type {
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
import {
  QUERY_STORE_EDIT_COMMANDS,
  executeAndAnalyze,
  flushMicrotasks,
  mockAnalyzeResult,
  mockJoinAnalyzeResult,
  mockOrderColumns,
  mockOrderPrimaryKey,
  mockPrimaryKey,
  mockTableColumns,
  overrideNamedCommands,
  registerQueryEditStoreSetup,
  resultWith,
} from '../helpers/query-store-fixtures'

registerQueryEditStoreSetup()

// ---------------------------------------------------------------------------
// setEditMode
// ---------------------------------------------------------------------------

describe('useQueryStore — setEditMode', () => {
  it('enables edit mode for a valid table', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const f = flat('tab-1')
    expect(f.view.editTarget.tableName).toBe('testdb.users')
    expect(f.view.editTarget.editableColumns.size).toBeGreaterThan(0)
    expect(f.view.slot.connectionId).toBe('conn-1')
    expect(f.view.edit.state).toBeNull()
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.foreignKeys).toEqual([
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), null)

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.editTarget.editableColumns.size).toBe(0)
    expect(tab.view.editTarget.bindings.size).toBe(0)
    expect(tab.view.editTarget.boundIndexByName.size).toBe(0)
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'somedb.nonexistent')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBe('testdb.users') // editing is enabled

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    let tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBe('testdb.users')

    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    tab = flat('tab-1')
    expect(tab.view.edit.state?.rowKey).toEqual({ id: 1 })
    expect(tab.view.edit.state?.originalValues).toMatchObject({
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    let tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBe('testdb.users')

    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    tab = flat('tab-1')
    expect(tab.view.edit.state?.rowKey).toEqual({ id: 1 })
    expect(tab.view.edit.state?.originalValues).toMatchObject({
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBe('testdb.users')
    expect(tab.view.editTarget.editableColumns.get(2)).toBe(true)

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.editTarget.bindings.size).toBe(0)
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.editTarget.bindings.size).toBe(0)
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.editTarget.bindings.size).toBe(0)
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.editTarget.bindings.size).toBe(0)
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.editTarget.bindings.size).toBe(0)
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    const countAfterFirst = analyzeCallCount

    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), null)
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
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

    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBe('testdb.users')
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.message?.includes('no primary'))).toBe(
      true
    )
  })
})

// ---------------------------------------------------------------------------
// clearEditState
// ---------------------------------------------------------------------------

describe('useQueryStore — clearEditState', () => {
  it('resets all edit-related fields to defaults', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')

    useQueryStore.getState().clearEditState(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.edit.state).toBeNull()
    expect(tab.view.editTarget.editableColumns.size).toBe(0)
    expect(tab.view.editTarget.tables).toEqual({})
    expect(tab.isAnalyzingQuery).toBe(false)
    expect(tab.view.edit.saveError).toBeNull()
    expect(tab.view.edit.rowIndex).toBeNull()
  })

  it('is called when executeQuery runs', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')

    // Verify edit state is active
    expect(flat('tab-1').view.editTarget.tableName).toBe('testdb.users')

    // Execute a new query
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    await flushMicrotasks()

    const tab = flat('tab-1')
    expect(tab.view.editTarget.tableName).toBeNull()
    expect(tab.view.edit.state).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// executeQuery — background analysis
// ---------------------------------------------------------------------------

describe('useQueryStore — executeQuery background analysis', () => {
  it('populates editTableMetadata after successful query with columns', async () => {
    await executeAndAnalyze()

    const tab = flat('tab-1')
    const tables = Object.values(tab.view.editTarget.tables)
    expect(tables).toHaveLength(1)
    expect(tables[0].table).toBe('users')
    expect(tab.view.editTarget.tables['testdb.users']).toBeDefined()
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
    expect(Object.keys(tab.view.editTarget.tables)).toEqual([])
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
    expect(Object.keys(tab.view.editTarget.tables)).toEqual([])
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
    expect(Object.keys(tab.view.editTarget.tables)).toEqual([])
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
    expect(Object.keys(tab.view.editTarget.tables)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getTabState — new defaults
// ---------------------------------------------------------------------------

describe('useQueryStore — getTabState default edit fields', () => {
  it('returns default edit fields for unknown tab', () => {
    const state = flat('unknown')
    expect(state.view.editTarget.tableName).toBeNull()
    expect(state.view.editTarget.tables).toEqual({})
    expect(state.view.edit.state).toBeNull()
    expect(state.isAnalyzingQuery).toBe(false)
    expect(state.view.editTarget.editableColumns).toBeInstanceOf(Map)
    expect(state.view.editTarget.editableColumns.size).toBe(0)
    expect(state.view.prompts.pendingNavigation).toBeNull()
    expect(state.view.edit.saveError).toBeNull()
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
// changeRowLimit — clears edit state before re-execution
// ---------------------------------------------------------------------------

describe('useQueryStore — changeRowLimit clears edit state', () => {
  it('clears edit mode, editableColumnMap, editTableMetadata, editState, and editingRowIndex', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')

    // Verify edit state is active
    const before = flat('tab-1')
    expect(before.view.editTarget.tableName).toBe('testdb.users')
    expect(before.view.edit.state).not.toBeNull()
    expect(before.view.editTarget.editableColumns.size).toBeGreaterThan(0)
    expect(Object.keys(before.view.editTarget.tables).length).toBeGreaterThan(0)
    expect(before.view.edit.rowIndex).toBe(0)

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-1', 500)
    await flushMicrotasks()

    const after = flat('tab-1')
    expect(after.view.editTarget.tableName).toBeNull()
    expect(after.view.edit.state).toBeNull()
    expect(after.view.editTarget.editableColumns.size).toBe(0)
    expect(after.view.editTarget.bindings.size).toBe(0)
    expect(after.view.editTarget.boundIndexByName.size).toBe(0)
    // editTableMetadata is cleared then repopulated by background analysis
    // After flushMicrotasks it should be repopulated
    expect(after.view.edit.rowIndex).toBeNull()
    expect(after.resultStatus).toBe('success')
  })
})

// ---------------------------------------------------------------------------
// sortResults (sort-clear) — clears edit state before re-execution
// ---------------------------------------------------------------------------

describe('useQueryStore — sortResults sort-clear clears edit state', () => {
  it('clearing a sort keeps edit mode but drops the editing row (no re-run)', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')

    // Verify edit state is active
    const before = flat('tab-1')
    expect(before.view.editTarget.tableName).toBe('testdb.users')
    expect(before.view.edit.state).not.toBeNull()

    await useQueryStore
      .getState()
      .sortResults(activeQuerySurfaceRef('tab-1'), { column: 'id', direction: null })
    await flushMicrotasks()

    const after = flat('tab-1')
    expect(after.view.editTarget.tableName).toBe('testdb.users')
    expect(after.view.editTarget.editableColumns.size).toBeGreaterThan(0)
    expect(after.view.edit.state).toBeNull()
    expect(after.view.edit.rowIndex).toBeNull()
    expect(after.view.edit.baseIndex).toBeNull()
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    // Normal sort (asc) should not clear edit mode
    await useQueryStore
      .getState()
      .sortResults(activeQuerySurfaceRef('tab-1'), { column: 'id', direction: 'asc' })

    const after = flat('tab-1')
    expect(after.view.editTarget.tableName).toBe('testdb.users')
    expect(after.view.editTarget.editableColumns.size).toBeGreaterThan(0)
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
            view: {
              slot: { columns: COLUMNS, queryId: 'q-1', viewVersion: 1 },
              selection: { rowIndex: 1 },
            },
            rows: ROWS,
            lastExecutedSql: 'SELECT * FROM people',
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
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), FILTER_A)
        expect(result().view.spec.applying).toBe('filter')
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
      expect(painted.view.spec.applying).not.toBe('filter')
      expect(painted.view.spec.filters).toEqual(FILTER_A)
      expect(painted.view.slot.viewVersion).toBe(2)
      expect(painted.view.slot.viewRowCount).toBe(2)
      expect(painted.view.slot.totalRows).toBe(3)
      expect(rowsOf(TAB)).toEqual([ROWS[0], ROWS[2]])
      // Checked rows and the selection belong to the old view.
      expect(painted.view.checked.ranges).toEqual([])
      expect(painted.view.checked.viewVersion).toBe(2)
      expect(painted.view.selection.rowIndex).toBeNull()
      expect(ipc.payloads('execute_query')).toHaveLength(0)
    })

    it('keeps the current sort when filtering', async () => {
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [TAB]: {
              ...state.tabs[TAB]!,
              results: [
                resultWith(
                  {
                    view: { spec: { sort: { column: 'name', direction: 'desc' } } },
                  },
                  result()
                ),
              ],
            },
          },
        }))
      })
      ipc.override('set_result_view', () => viewResponse(2, [ROWS[2]], [2]))

      await act(async () => {
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), FILTER_A)
        await flush()
      })

      expect(ipc.payloads('set_result_view')[0]).toMatchObject({
        viewSpec: { sort: { column: 'name', direction: 'desc' }, filters: FILTER_A },
      })
      expect(result().view.spec.sort?.column).toBe('name')
    })

    it('clearing filters restores the unfiltered view in Rust without a re-run', async () => {
      ipc.override('set_result_view', () => viewResponse(3, ROWS, [0, 1, 2]))

      await act(async () => {
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), [])
        await flush()
      })

      expect(ipc.payloads('set_result_view')[0]).toMatchObject({
        viewSpec: { sort: null, filters: [] },
      })
      expect(result().view.spec.filters).toEqual([])
      expect(rowsOf(TAB)).toEqual(ROWS)
      expect(ipc.payloads('execute_query')).toHaveLength(0)
      expect(ipc.payloads('reexecute_single_result')).toHaveLength(0)
    })

    it('ignores an out-of-range result index', () => {
      useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 5), FILTER_A)
      useQueryStore.getState().applyQueryFilters(querySurfaceRef('missing', 0), FILTER_A)
      expect(ipc.payloads('set_result_view')).toHaveLength(0)
    })
  })

  describe('sortResults', () => {
    it('shows the sorting overlay while the view request is pending', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'id', direction: 'asc' })
      })
      expect(result().view.spec.applying).toBe('sort')
      await act(async () => {
        pending[0].resolve(viewResponse(2, ROWS, [0, 1, 2]))
        await sortPromise
      })
      expect(result().view.spec.applying).not.toBe('sort')
    })

    it('discards a response for a result that was replaced meanwhile', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'id', direction: 'asc' })
      })
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [TAB]: {
              ...state.tabs[TAB]!,
              results: [
                resultWith(
                  {
                    view: { slot: { queryId: 'q-new' } },
                  },
                  result()
                ),
              ],
            },
          },
        }))
      })
      await act(async () => {
        pending[0].resolve(viewResponse(9, [ROWS[2]], [2]))
        await sortPromise
      })
      expect(result().view.slot.viewVersion).toBe(1)
      expect(result().view.spec.sort).toBeNull()
    })
  })

  describe('overlapping view changes (D15)', () => {
    it('an older success updates the latest known version; a superseded newer request is re-issued once and painted', async () => {
      const pending = deferSetResultView()

      // Filter A (seq 1) and sort B (seq 2) both start from version 1.
      act(() => {
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), FILTER_A)
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'name', direction: 'asc' })
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
      expect(result().view.slot.viewVersion).toBe(1)
      expect(result().view.spec.filters).toEqual([])

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
      expect(painted.view.slot.viewVersion).toBe(3)
      expect(painted.view.spec.sort?.column).toBe('name')
      expect(painted.view.spec.filters).toEqual(FILTER_A)
      expect(painted.view.spec.error).toBeNull()

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
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), FILTER_A)
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'name', direction: 'asc' })
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
      expect(reverted.view.slot.viewVersion).toBe(2)
      expect(reverted.view.spec.filters).toEqual(FILTER_A)
      expect(reverted.view.spec.sort).toBeNull()
      expect(reverted.view.spec.error).toBe('view_superseded: current=2')
      expect(reverted.view.spec.applying).not.toBe('sort')
      expect(rowsOf(TAB)).toEqual([ROWS[0], ROWS[2]])
      expect(
        useToastStore.getState().toasts.some((t) => t.title === "Couldn't apply sort or filter")
      ).toBe(true)
    })

    it('a newer request failing with a non-superseded error reverts to the latest success without re-issuing', async () => {
      const pending = deferSetResultView()
      act(() => {
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), FILTER_A)
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'missing', direction: 'asc' })
      })
      await act(async () => {
        pending[0].resolve(viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
        pending[1].reject(new Error("Sort column 'missing' not found"))
        await sortPromise
      })

      expect(pending).toHaveLength(2)
      expect(result().view.slot.viewVersion).toBe(2)
      expect(result().view.spec.filters).toEqual(FILTER_A)
      expect(result().view.spec.error).toBe("Sort column 'missing' not found")
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
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'id', direction: 'asc' })
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
      expect(result().view.slot.viewVersion).toBe(4)
      expect(result().view.spec.error).toBe('view_superseded: current=4')
      expect(rowsOf(TAB)).toEqual([ROWS[1]])
    })

    it('with no successful view and no newer version, only shows the band', async () => {
      ipc.override('set_result_view', () => {
        throw new Error('boom')
      })
      await act(async () => {
        await useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'id', direction: 'asc' })
      })
      expect(result().view.slot.viewVersion).toBe(1)
      expect(result().view.spec.sort).toBeNull()
      expect(result().view.spec.error).toBe('boom')
      expect(rowsOf(TAB)).toEqual(ROWS)
    })

    it('keeps the band when refetching the server view also fails', async () => {
      const pending = deferSetResultView()
      ipc.override('fetch_result_window', () => {
        throw new Error('offline')
      })
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'id', direction: 'asc' })
      })
      await act(async () => {
        pending[0].reject(new Error('view_superseded: current=4'))
        await flush()
        pending[1].reject(new Error('view_superseded: current=4'))
        await sortPromise
      })
      expect(result().view.spec.error).toBe('view_superseded: current=4')
      expect(result().view.spec.applying).not.toBe('sort')
    })

    it('a success older than a tombstone write repaints the server view with its spec', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'name', direction: 'desc' })
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
                results: [
                  resultWith(
                    {
                      view: { slot: { viewVersion: 3 } },
                      latestKnownViewVersion: 3,
                    },
                    tab.results[0]
                  ),
                ],
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
      expect(painted.view.slot.viewVersion).toBe(3)
      expect(painted.view.spec.sort).toEqual({ column: 'name', direction: 'desc' })
      expect(painted.view.spec.applying).not.toBe('sort')
      expect(painted.view.spec.error).toBeNull()
      expect(rowsOf(TAB)).toEqual([ROWS[2], ROWS[0]])
    })

    it('settles with the view-error band when repainting the server view fails', async () => {
      const pending = deferSetResultView()
      let sortPromise: Promise<void> = Promise.resolve()
      act(() => {
        sortPromise = useQueryStore
          .getState()
          .sortResults(activeQuerySurfaceRef(TAB), { column: 'name', direction: 'desc' })
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
      expect(result().view.spec.applying).not.toBe('sort')
      expect(result().view.spec.error).toBe('offline')
    })

    it('Retry re-issues the latest requested spec', async () => {
      ipc.override('set_result_view', () => {
        throw new Error('boom')
      })
      await act(async () => {
        useQueryStore.getState().applyQueryFilters(querySurfaceRef(TAB, 0), FILTER_A)
        await flush()
      })
      expect(result().view.spec.error).toBe('boom')

      ipc.override('set_result_view', () => viewResponse(2, [ROWS[0], ROWS[2]], [0, 2]))
      await act(async () => {
        retryViewChange(activeQuerySurfaceRef(TAB))
        await flush()
      })
      expect(ipc.payloads('set_result_view')[1]).toMatchObject({
        viewSpec: { sort: null, filters: FILTER_A },
      })
      expect(result().view.spec.error).toBeNull()
      expect(result().view.spec.filters).toEqual(FILTER_A)
    })

    it('retryViewChange is a no-op for unknown tabs', () => {
      retryViewChange(activeQuerySurfaceRef('missing'))
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
            [TAB]: {
              ...state.tabs[TAB]!,
              results: [
                resultWith(
                  {
                    view: { slot: { viewRowCount: 3000 } },
                  },
                  result()
                ),
              ],
            },
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
        retryWindow(activeQuerySurfaceRef(TAB))
      })
      expect(result().view.window.failedRange).toBeNull()
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

  function setTab(results: SingleResultState[], content = 'SELECT id, name FROM t') {
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
            results: results,
            activeResultIndex: 0,
            activeBottomPanelItem: { type: 'result' },
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
            runExport: null,
          },
        },
      })
    })
  }

  const SORTED_FILTERED = resultWith({
    resultStatus: 'success',
    latestKnownViewVersion: 4,
    lastExecutedSql: 'SELECT id, name FROM t',
    reExecutable: true,
    ...withRows([
      [2, 'Dana'],
      [1, 'Ada'],
    ]),
    view: {
      slot: { queryId: 'q-old', columns: COLUMNS, totalRows: 3, viewVersion: 4 },
      spec: { filters: FILTERS, sort: { column: 'name', direction: 'desc' } },
    },
  })

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
      expect(result.view.slot.queryId).toBe('q-new')
      expect(result.view.spec.sort?.column).toBe('name')
      // The condition on the missing column is dropped without an error.
      expect(result.view.spec.filters).toEqual([FILTERS[0]])
      expect(result.view.slot.viewRowCount).toBe(2)
      expect(rowsOf(TAB)).toEqual(RERUN_WINDOW_ROWS)
    })

    it('a multi-result re-execute passes the view spec to reexecute_single_result', async () => {
      setTab([
        SORTED_FILTERED,
        resultWith(
          {
            view: { slot: { queryId: 'q-other' }, spec: { filters: [], sort: null } },
          },
          SORTED_FILTERED
        ),
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
      setTab([resultWith({ view: { spec: { sort: null, filters: [] } } }, SORTED_FILTERED)])
      ipc.override('execute_query', () => windowedResponse({ columns: COLUMNS }))

      await act(async () => {
        await useQueryStore.getState().changeRowLimit(CONN, TAB, 10)
      })

      expect('viewSpec' in (ipc.payloads('execute_query')[0] as Record<string, unknown>)).toBe(
        false
      )
    })

    it('restoring an expired single result re-runs once with the view spec', async () => {
      setTab([resultWith({ view: { residency: { isExpired: true } } }, SORTED_FILTERED)])
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
      expect(result.view.residency.isExpired).toBe(false)
      expect(result.view.spec.sort?.column).toBe('name')
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
        resultWith(
          {
            view: {
              slot: { connectionId: CONN },
              selection: { rowIndex: 0 },
              editTarget: {
                tableName: 'db.t',
                tables: { 'db.t': tableInfo },
                editableColumns: new Map([
                  [0, false],
                  [1, true],
                ]),
                bindings: new Map([
                  [0, 'id'],
                  [1, 'name'],
                ]),
                boundIndexByName: new Map([
                  ['id', 0],
                  ['name', 1],
                ]),
              },
            },
          },
          SORTED_FILTERED
        ),
      ])
      ipc.override('insert_table_row', () => [['id', 9]])
      ipc.override('execute_query', () =>
        windowedResponse({ queryId: 'q-after-insert', columns: COLUMNS, totalRows: 4 })
      )

      act(() => {
        useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef(TAB))
      })
      await act(async () => {
        await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef(TAB))
      })

      expect(ipc.payloads('insert_table_row')).toHaveLength(1)
      expect(ipc.payloads('execute_query')[0]).toMatchObject({ viewSpec: EXPECTED_SPEC })
      expect(useQueryStore.getState().tabs[TAB]!.results[0].view.slot.queryId).toBe(
        'q-after-insert'
      )
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
        resultWith(
          {
            view: {
              slot: { connectionId: CONN },
              editTarget: {
                tableName: 'db.t',
                tables: { 'db.t': tableInfo },
                editableColumns: new Map([[1, true]]),
                bindings: new Map([
                  [0, 'id'],
                  [1, 'name'],
                ]),
                boundIndexByName: new Map([
                  ['id', 0],
                  ['name', 1],
                ]),
              },
            },
          },
          SORTED_FILTERED
        ),
      ])
      // The sorted, filtered view: position 0 is base row 2, position 1 is base row 0.
      seedResultWindow({
        route: 'query',
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
        useQueryStore.getState().startEditingRow(activeQuerySurfaceRef(TAB), 1)
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef(TAB), 1, 'Zed')
      })
      expect(useQueryStore.getState().tabs[TAB]!.results[0].view.edit.baseIndex).toBe(0)

      await act(async () => {
        expect(await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef(TAB))).toBe(true)
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
      expect(result.view.slot.viewVersion).toBe(4)
      expect(result.view.edit.state).toBeNull()
    })
  })
})
