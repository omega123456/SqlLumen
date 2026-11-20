import { describe, it, expect } from 'vitest'
import { ipc } from '../../ipc-mock'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { flat, firstWindowFor } from '../../helpers/query-test-utils'
import {
  QUERY_STORE_EDIT_COMMANDS,
  executeAndAnalyze,
  flushMicrotasks,
  mockBlobEnvelope,
  mockJoinAnalyzeResult,
  mockPrimaryKey,
  mockTableColumns,
  overrideNamedCommands,
  patchResult,
  registerQueryEditStoreSetup,
} from '../../helpers/query-store-fixtures'

registerQueryEditStoreSetup()

// ---------------------------------------------------------------------------
// startEditingRow
// ---------------------------------------------------------------------------

describe('startEditingRow', () => {
  it('creates edit state for the specified row', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)

    const tab = flat('tab-1')
    expect(tab.view.edit.state).not.toBeNull()
    expect(tab.view.edit.state!.rowKey).toEqual({ id: 1 })
    expect(tab.view.edit.state!.originalValues.name).toBe('Alice')
    expect(tab.view.edit.state!.modifiedColumns.size).toBe(0)
    expect(tab.view.edit.rowIndex).toBe(0)
  })

  it('does nothing when edit mode is not enabled', async () => {
    await executeAndAnalyze()
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)

    const tab = flat('tab-1')
    expect(tab.view.edit.state).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateCellValue
// ---------------------------------------------------------------------------

describe('updateCellValue', () => {
  it('updates currentValues and modifiedColumns', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Charlie')

    const tab = flat('tab-1')
    expect(tab.view.edit.state!.currentValues.name).toBe('Charlie')
    expect(tab.view.edit.state!.modifiedColumns.has('name')).toBe(true)
  })

  it('removes from modifiedColumns when value reverts to original', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Charlie')
    expect(flat('tab-1').view.edit.state!.modifiedColumns.has('name')).toBe(true)

    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Alice')
    expect(flat('tab-1').view.edit.state!.modifiedColumns.has('name')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// syncCellValue
// ---------------------------------------------------------------------------

describe('syncCellValue', () => {
  it('updates editState and leaves the cached row untouched (the grid overlays edits)', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Dave')

    const tab = flat('tab-1')
    expect(tab.view.edit.state!.currentValues.name).toBe('Dave')
    expect(tab.view.edit.state!.modifiedColumns.has('name')).toBe(true)
    // Handed-out cached rows are never mutated while editing.
    expect(tab.rows[0][1]).toBe('Alice')
    expect(tab.view.edit.baseIndex).toBe(0)
  })

  it('removes from modifiedColumns when value reverts to original', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')
    expect(flat('tab-1').view.edit.state!.modifiedColumns.has('name')).toBe(true)

    // Revert to original value
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Alice')
    expect(flat('tab-1').view.edit.state!.modifiedColumns.has('name')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// discardCurrentRow
// ---------------------------------------------------------------------------

describe('discardCurrentRow', () => {
  it('restores original values in local row data', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Modified')

    // The edit lives in editState only; the cached row is untouched.
    expect(flat('tab-1').view.edit.state?.currentValues.name).toBe('Modified')
    expect(flat('tab-1').rows[0][1]).toBe('Alice')

    useQueryStore.getState().discardCurrentRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.view.edit.state).toBeNull()
    expect(tab.view.edit.rowIndex).toBeNull()
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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 0, 5)

    expect(flat('tab-1').view.edit.state?.modifiedColumns.size).toBe(1)
    expect(flat('tab-1').rows[0][0]).toBe(1)

    useQueryStore.getState().discardCurrentRow(activeQuerySurfaceRef('tab-1'))

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
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)

    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, mockBlobEnvelope)
    expect(flat('tab-1').view.edit.state?.currentValues.photo).toEqual(mockBlobEnvelope)

    useQueryStore.getState().discardCurrentRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.view.edit.state).toBeNull()
    expect(tab.view.edit.rowIndex).toBeNull()
    expect(tab.rows[0][1]).toBe('SGVsbG8=')
  })

  it('removes a cloned draft without changing the source row', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().setSelectedRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().cloneSelectedRow(activeQuerySurfaceRef('tab-1'))
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Clone Only')

    expect(flat('tab-1').rows).toHaveLength(2)
    expect(flat('tab-1').view.edit.draftRow?.[1]).toBe('Clone Only')

    useQueryStore.getState().discardCurrentRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.rows).toEqual([
      [1, 'Alice', 'alice@test.com'],
      [2, 'Bob', 'bob@test.com'],
    ])
    expect(tab.view.edit.state).toBeNull()
    expect(tab.view.edit.rowIndex).toBeNull()
    expect(tab.view.selection.rowIndex).toBeNull()
  })

  it('clears editState when editingRowIndex is null', async () => {
    await executeAndAnalyze()

    // Manually set editState but with null editingRowIndex
    patchResult('tab-1', {
      view: {
        edit: {
          state: {
            rowKey: { id: 1 },
            originalValues: { id: 1, name: 'Alice' },
            currentValues: { id: 1, name: 'Changed' },
            modifiedColumns: new Set(['name']),
            isNewRow: false,
          },
          rowIndex: null,
        },
      },
    })

    useQueryStore.getState().discardCurrentRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.view.edit.state).toBeNull()
    expect(tab.view.edit.rowIndex).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// insertDraftRow
// ---------------------------------------------------------------------------

describe('insertDraftRow', () => {
  it('opens an empty insert draft right after the last view row', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')

    useQueryStore.getState().insertDraftRow(activeQuerySurfaceRef('tab-1'))

    const tab = flat('tab-1')
    expect(tab.rows).toHaveLength(2)
    expect(tab.view.edit.draftRow).toEqual([null, null, null])
    expect(tab.view.selection.rowIndex).toBe(2)
    expect(tab.view.edit.rowIndex).toBe(2)
    expect(tab.view.edit.baseIndex).toBeNull()
    expect(tab.view.edit.state?.isNewRow).toBe(true)
    expect(tab.view.edit.state?.modifiedColumns.size).toBe(0)
  })

  it('inserts the values typed into the draft when saved', async () => {
    ipc.override('insert_table_row', () => [['id', 3]])
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().insertDraftRow(activeQuerySurfaceRef('tab-1'))
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Carol')
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 2, 'carol@test.com')

    await useQueryStore.getState().saveCurrentRow(activeQuerySurfaceRef('tab-1'))

    expect(ipc.payloads('insert_table_row')[0]).toMatchObject({
      database: 'testdb',
      table: 'users',
      values: { name: 'Carol', email: 'carol@test.com' },
    })
  })

  it('refuses with a toast while another row has unsaved changes', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Alicia')

    useQueryStore.getState().insertDraftRow(activeQuerySurfaceRef('tab-1'))

    expect(flat('tab-1').view.edit.draftRow).toBeNull()
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((toast) => toast.title === 'Unsaved changes')).toBe(true)
  })

  it('does nothing when edit mode is not enabled', async () => {
    await executeAndAnalyze()

    useQueryStore.getState().insertDraftRow(activeQuerySurfaceRef('tab-1'))

    expect(flat('tab-1').view.edit.draftRow).toBeNull()
    expect(flat('tab-1').view.edit.state).toBeNull()
  })
})
