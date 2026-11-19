import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { ipc } from '../../ipc-mock'
import React from 'react'
import { useQueryStore, activeQuerySurfaceRef, querySurfaceRef } from '../../../stores/query-store'
import { makeTabState } from '../../helpers/query-test-utils'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import * as ResultGridViewModule from '../../../components/query-editor/ResultGridView'

/**
 * Tests for ResultPanel edit mode callback wiring.
 *
 * Uses vi.spyOn to capture callback props passed to ResultGridView and invoke them directly.
 */

// Store captured ResultGridView props for test assertions
let capturedGridProps: Record<string, unknown> = {}

// Use vi.spyOn in beforeEach to install per-test mock implementations without vi.mock().

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  capturedGridProps = {}

  ipc.override('execute_query', () => ({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    autoLimitApplied: false,
    rows: [],
  }))
  ipc.override('fetch_cached_rows', () => ({ rows: [], columns: [] }))
  ipc.override('evict_results', () => undefined)
  ipc.override('sort_results', () => ({ rows: [] }))
  ipc.override('export_results', () => ({ bytesWritten: 1024, rowsExported: 5 }))
  ipc.override('update_table_row', () => undefined)

  vi.spyOn(ResultGridViewModule.ResultGridView, 'type').mockImplementation((props) => {
    capturedGridProps = props as unknown as Record<string, unknown>
    return (<div data-testid="result-grid-view">Grid Mock</div>) as unknown as React.ReactElement
  })
})

describe('ResultPanel edit mode callbacks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderWithEditState() {
    useQueryStore.setState({
      tabs: {
        'tab-1': makeTabState({
          status: 'success',
          viewMode: 'grid',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          rows: [['1', 'Alice']],
          totalRows: 1,
          queryId: 'q1',
          editMode: 'users',
          editableColumnMap: new Map([
            [0, false],
            [1, true],
          ]),
        }),
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
  }

  it('routes the grid edit callbacks to the store actions', () => {
    const startEditingRowSpy = vi.spyOn(useQueryStore.getState(), 'startEditingRow')
    const updateCellValueSpy = vi.spyOn(useQueryStore.getState(), 'updateCellValue')
    const syncCellValueSpy = vi.spyOn(useQueryStore.getState(), 'syncCellValue')
    renderWithEditState()

    const onStartEditing = capturedGridProps.onStartEditing as (rowIndex: number) => void
    const onUpdateCellValue = capturedGridProps.onUpdateCellValue as (
      columnIndex: number,
      value: unknown
    ) => void
    const onSyncCellValue = capturedGridProps.onSyncCellValue as (
      columnIndex: number,
      value: unknown
    ) => void
    onStartEditing(0)
    onUpdateCellValue(1, 'Bob')
    onSyncCellValue(1, 'Charlie')

    expect(startEditingRowSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0), 0, undefined)
    expect(updateCellValueSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0), 1, 'Bob')
    expect(syncCellValueSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0), 1, 'Charlie')
  })

  it('auto-saves through store.saveCurrentRow and reports whether the save succeeded', async () => {
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    renderWithEditState()

    const onAutoSave = capturedGridProps.onAutoSave as () => Promise<boolean>
    let succeeded = false
    let failed = true
    await act(async () => {
      succeeded = await onAutoSave()
      failed = await onAutoSave()
    })

    expect(saveCurrentRowSpy).toHaveBeenCalledWith(querySurfaceRef('tab-1', 0))
    expect(succeeded).toBe(true)
    expect(failed).toBe(false)
  })

  it('passes editMode and editableColumnMap from store to ResultGridView', () => {
    renderWithEditState()

    expect(capturedGridProps.editMode).toBe('users')
    expect(capturedGridProps.editableColumnMap).toBeInstanceOf(Map)
    const map = capturedGridProps.editableColumnMap as Map<number, boolean>
    expect(map.get(0)).toBe(false)
    expect(map.get(1)).toBe(true)
  })

  it('passes editState and editingRowIndex from store to ResultGridView', () => {
    const editState = {
      rowKey: { id: 1 },
      originalValues: { name: 'Alice' },
      currentValues: { name: 'Alice' },
      modifiedColumns: new Set<string>(),
      isNewRow: false,
    }
    useQueryStore.setState({
      tabs: {
        'tab-1': makeTabState({
          status: 'success',
          viewMode: 'grid',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          rows: [['1', 'Alice']],
          totalRows: 1,
          queryId: 'q1',
          editMode: 'users',
          editableColumnMap: new Map([
            [0, false],
            [1, true],
          ]),
          editState,
          editingRowIndex: 0,
        }),
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    expect(capturedGridProps.editState).toBe(editState)
    expect(capturedGridProps.editingRowIndex).toBe(0)
  })

  it('passes editForeignKeys from store to ResultGridView', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': makeTabState({
          status: 'success',
          viewMode: 'grid',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'email', dataType: 'VARCHAR' },
          ],
          rows: [['1', 'alice@example.com']],
          totalRows: 1,
          queryId: 'q1',
          editMode: 'users',
          editForeignKeys: [
            {
              columnName: 'email',
              referencedDatabase: 'testdb',
              referencedTable: 'users',
              referencedColumn: 'id',
              constraintName: 'fk_users_email',
            },
          ],
        }),
      },
    })

    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    expect(capturedGridProps.editForeignKeys).toEqual([
      {
        columnName: 'email',
        referencedDatabase: 'testdb',
        referencedTable: 'users',
        referencedColumn: 'id',
        constraintName: 'fk_users_email',
      },
    ])
  })
})

describe('edit callback stability (focus-loss regression)', () => {
  /**
   * Regression test for focus-loss bug in ResultGridView edit mode.
   *
   * Bug: clicking a cell opens the editor, but every keypress causes the
   * editor to unmount and remount (losing focus), so only one character
   * can be typed at a time.
   *
   * Root cause: ResultPanel consumed the entire query store via
   * `useQueryStore()` (no selector), which meant every store update gave
   * a new `store` reference.  All `useCallback` hooks that depended on
   * `store` got new identities on each update, cascading into
   * ResultGridView → wrapped callbacks → column definitions →
   * renderEditCell function identity change → React unmount/remount of
   * the editor component → focus lost.
   *
   * The test renders ResultPanel (with ResultGridView mocked to capture
   * props), then simulates a cell edit by calling onSyncCellValue (which
   * updates the store).  After re-render, the callback references passed
   * to ResultGridView must remain the SAME objects — proving that the
   * cascade is broken and the editor will keep focus.
   */

  // Track callback references across renders
  const capturedCallbacksByRender: Array<{
    onUpdateCellValue: unknown
    onSyncCellValue: unknown
    onAutoSave: unknown
    onStartEditing: unknown
  }> = []

  // Use vi.spyOn in beforeEach to install per-test mock implementations without vi.mock().

  beforeEach(() => {
    useQueryStore.setState({ tabs: {} })
    capturedCallbacksByRender.length = 0

    ipc.override('execute_query', () => ({
      queryId: 'q1',
      columns: [],
      totalRows: 0,
      executionTimeMs: 0,
      affectedRows: 0,
      autoLimitApplied: false,
      rows: [],
    }))
    ipc.override('fetch_cached_rows', () => ({ rows: [], columns: [] }))
    ipc.override('evict_results', () => undefined)
    ipc.override('sort_results', () => ({ rows: [] }))
    ipc.override('export_results', () => ({ bytesWritten: 1024, rowsExported: 5 }))
    ipc.override('update_table_row', () => undefined)

    vi.spyOn(ResultGridViewModule.ResultGridView, 'type').mockImplementation((props) => {
      const p = props as unknown as Record<string, unknown>
      capturedCallbacksByRender.push({
        onUpdateCellValue: p.onUpdateCellValue,
        onSyncCellValue: p.onSyncCellValue,
        onAutoSave: p.onAutoSave,
        onStartEditing: p.onStartEditing,
      })
      return (<div data-testid="result-grid-view">Grid Mock</div>) as unknown as React.ReactElement
    })
  })

  describe('ResultPanel edit-mode callback stability (focus-loss regression)', () => {
    /**
     * Set up the store with edit mode active and a row being edited,
     * then render ResultPanel.
     */
    function renderWithActiveEditing() {
      useQueryStore.setState({
        tabs: {
          'tab-1': makeTabState({
            status: 'success',
            viewMode: 'grid',
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
            ],
            rows: [
              [1, 'Alice'],
              [2, 'Bob'],
            ],
            totalRows: 2,
            queryId: 'q1',
            lastExecutedSql: 'SELECT id, name FROM users',
            editMode: 'test_db.users',
            editConnectionId: 'conn-1',
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
            editTableMetadata: {
              'test_db.users': {
                database: 'test_db',
                table: 'users',
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
                primaryKey: {
                  keyColumns: ['id'],
                  hasAutoIncrement: true,
                  isUniqueKeyFallback: false,
                },
                foreignKeys: [],
              },
            },
            editState: {
              rowKey: { id: 1 },
              originalValues: { id: 1, name: 'Alice' },
              currentValues: { id: 1, name: 'Alice' },
              modifiedColumns: new Set<string>(),
              isNewRow: false,
            },
            editingRowIndex: 0,
          }),
        },
      })
      return render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    }

    it('keeps every edit callback reference stable across consecutive cell syncs', () => {
      renderWithActiveEditing()

      const initialCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]
      const renderCountBeforeSync = capturedCallbacksByRender.length

      act(() => {
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'A')
      })
      expect(capturedCallbacksByRender.length).toBeGreaterThan(renderCountBeforeSync)
      act(() => {
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Al')
      })
      act(() => {
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Ali')
      })

      // A changed reference recomputes the column definitions, remounts the editor and loses focus.
      const latestCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]
      expect(latestCallbacks.onUpdateCellValue).toBe(initialCallbacks.onUpdateCellValue)
      expect(latestCallbacks.onSyncCellValue).toBe(initialCallbacks.onSyncCellValue)
      expect(latestCallbacks.onAutoSave).toBe(initialCallbacks.onAutoSave)
      expect(latestCallbacks.onStartEditing).toBe(initialCallbacks.onStartEditing)
    })
  })
})
