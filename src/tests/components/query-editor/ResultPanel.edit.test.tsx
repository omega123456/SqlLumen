import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { ipc } from '../../ipc-mock'
import React from 'react'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { makeTabState } from '../../helpers/query-test-utils'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import * as DataGridViewModule from '../../../components/shared/data-view/DataGridView'

/**
 * Tests for ResultPanel edit mode callback wiring.
 *
 * Uses vi.spyOn to capture callback props passed to ResultGridView and invoke them directly.
 */

describe('edit callback stability (focus-loss regression)', () => {
  /**
   * Regression test for focus-loss bug in the result grid edit mode.
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
  const capturedSourcesByRender: unknown[] = []

  // Use vi.spyOn in beforeEach to install per-test mock implementations without vi.mock().

  beforeEach(() => {
    useQueryStore.setState({ tabs: {} })
    capturedSourcesByRender.length = 0

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

    vi.spyOn(DataGridViewModule.DataGridView, 'type').mockImplementation((props) => {
      capturedSourcesByRender.push((props as unknown as Record<string, unknown>).source)
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
            view: {
              mode: 'grid',
              slot: {
                columns: [
                  { name: 'id', dataType: 'INT' },
                  { name: 'name', dataType: 'VARCHAR' },
                ],
                totalRows: 2,
                queryId: 'q1',
                connectionId: 'conn-1',
              },
              editTarget: {
                tableName: 'test_db.users',
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
                tables: {
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
              },
              edit: {
                state: {
                  rowKey: { id: 1 },
                  originalValues: { id: 1, name: 'Alice' },
                  currentValues: { id: 1, name: 'Alice' },
                  modifiedColumns: new Set<string>(),
                  isNewRow: false,
                },
                rowIndex: 0,
              },
            },
            rows: [
              [1, 'Alice'],
              [2, 'Bob'],
            ],
            lastExecutedSql: 'SELECT id, name FROM users',
          }),
        },
      })
      return render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    }

    it('keeps the grid source stable across consecutive cell syncs', () => {
      renderWithActiveEditing()

      const initialSource = capturedSourcesByRender[capturedSourcesByRender.length - 1]

      act(() => {
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'A')
      })
      act(() => {
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Al')
      })
      act(() => {
        useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Ali')
      })

      // A changed source re-renders the grid from the panel, recomputes the column definitions,
      // remounts the editor and loses focus.
      expect(capturedSourcesByRender.every((source) => source === initialSource)).toBe(true)
      expect(
        useQueryStore.getState().tabs['tab-1'].results[0].view.edit.state?.currentValues.name
      ).toBe('Ali')
    })
  })
})
