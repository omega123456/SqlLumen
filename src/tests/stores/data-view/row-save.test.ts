import { describe, it, expect, vi } from 'vitest'
import { ipc } from '../../ipc-mock'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { flat, firstWindowFor } from '../../helpers/query-test-utils'
import { bytesEnvelope } from '../../../lib/blob-utils'
import {
  QUERY_STORE_EDIT_COMMANDS,
  executeAndAnalyze,
  flushMicrotasks,
  mockAnalyzeResult,
  mockBlobEnvelope,
  mockJoinAnalyzeResult,
  mockNaturalAnalyzeResult,
  mockPrimaryKey,
  mockTableColumns,
  overrideNamedCommands,
  patchResult,
  registerQueryEditStoreSetup,
} from '../../helpers/query-store-fixtures'

registerQueryEditStoreSetup()

// ---------------------------------------------------------------------------
// saveCurrentRow
// ---------------------------------------------------------------------------

describe('saveCurrentRow', () => {
  it('calls updateTableRow and clears editState on success, returns true', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Updated')

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Saved Value')

    await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Updated')

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

    expect(result).toBe(false)
    const tab = flat('tab-1')
    expect(tab.saveError).toContain('Duplicate entry')
    expect(tab.editState).not.toBeNull() // edit state preserved on failure

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.title === 'Save failed')).toBe(true)
  })

  it('clears editState without IPC when nothing is modified, returns true', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)

    // No updateCellValue — nothing modified
    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 0, 5)

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, mockBlobEnvelope)

    const staged = flat('tab-1')
    expect(staged.editingRowIndex).toBe(0)
    expect(staged.editState?.originalValues.photo).toBe('SGVsbG8=')
    expect(staged.editState?.currentValues.photo).toEqual(mockBlobEnvelope)
    expect(staged.rows[0][1]).toBe('SGVsbG8=')

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Alicia')

    await expect(
      useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))
    ).resolves.toBe(true)

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.projects')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 0, 'p-002')

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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

  it('clones BLOB values as byte envelopes so the insert writes the bytes, not their base64 text', async () => {
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
          firstWindow: firstWindowFor([[1, 'Alice', 'q80=']]),

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const cloned = flat('tab-1')
    expect(cloned.draftRow).toEqual([null, 'Alice', bytesEnvelope('q80=')])

    await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

    expect(insertTableRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          name: 'Alice',
          avatar_blob: bytesEnvelope('q80='),
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))

    const savePromise = useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))
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
// saveCurrentRow — return value for no-op cases
// ---------------------------------------------------------------------------

describe('saveCurrentRow return value edge cases', () => {
  it('returns true when no editState exists', async () => {
    await executeAndAnalyze()
    // No edit mode enabled — no editState
    const result = await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))
    expect(result).toBe(true)
  })
})
