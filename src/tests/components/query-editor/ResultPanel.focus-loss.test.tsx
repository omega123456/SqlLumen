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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import React from 'react'
import { useQueryStore, type TabQueryState } from '../../../stores/query-store'

// Track callback references across renders
const capturedCallbacksByRender: Array<{
  onUpdateCellValue: unknown
  onSyncCellValue: unknown
  onAutoSave: unknown
  onStartEditing: unknown
}> = []

// Mock ResultGridView to capture props on every render
vi.mock('../../../components/query-editor/ResultGridView', () => ({
  ResultGridView: vi.fn((props: Record<string, unknown>) => {
    capturedCallbacksByRender.push({
      onUpdateCellValue: props.onUpdateCellValue,
      onSyncCellValue: props.onSyncCellValue,
      onAutoSave: props.onAutoSave,
      onStartEditing: props.onStartEditing,
    })
    return React.createElement('div', { 'data-testid': 'result-grid-view' }, 'Grid Mock')
  }),
}))

// Mock clipboard utility (used by ResultFormView and ResultTextView)
vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}))

// Mock export-commands (used by ExportDialog)
vi.mock('../../../lib/export-commands', () => ({
  exportResults: vi.fn().mockResolvedValue({ bytesWritten: 1024, rowsExported: 5 }),
}))

// Mock query-commands (used by query store)
vi.mock('../../../lib/query-commands', () => ({
  executeQuery: vi.fn().mockResolvedValue({
    queryId: 'q1',
    columns: [],
    totalRows: 0,
    executionTimeMs: 0,
    affectedRows: 0,
    totalPages: 1,
    autoLimitApplied: false,
    firstPage: [],
  }),
  fetchResultPage: vi.fn().mockResolvedValue({ rows: [], page: 1, totalPages: 1 }),
  evictResults: vi.fn().mockResolvedValue(undefined),
  sortResults: vi.fn().mockResolvedValue({ rows: [], page: 1, totalPages: 1 }),
  analyzeQueryForEdit: vi.fn().mockResolvedValue([]),
  updateResultCell: vi.fn().mockResolvedValue(undefined),
}))

// Mock table-data-commands (used by saveCurrentRow)
vi.mock('../../../lib/table-data-commands', () => ({
  updateTableRow: vi.fn().mockResolvedValue(undefined),
}))

import { ResultPanel } from '../../../components/query-editor/ResultPanel'

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  filePath: null,
  status: 'idle',
  columns: [],
  rows: [],
  totalRows: 0,
  executionTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  currentPage: 1,
  totalPages: 1,
  pageSize: 1000,
  autoLimitApplied: false,
  errorMessage: null,
  cursorPosition: null,
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  exportDialogOpen: false,
  lastExecutedSql: null,
  editMode: null,
  editTableMetadata: {},
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  pendingNavigationAction: null,
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  capturedCallbacksByRender.length = 0
  mockIPC(() => null)
})

describe('ResultPanel edit-mode callback stability (focus-loss regression)', () => {
  /**
   * Set up the store with edit mode active and a row being edited,
   * then render ResultPanel.
   */
  function renderWithActiveEditing() {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
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
        },
      },
    })
    return render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
  }

  it('onUpdateCellValue reference stays stable after a cell value is synced to the store', () => {
    renderWithActiveEditing()

    // Capture initial callbacks (render 1)
    expect(capturedCallbacksByRender.length).toBeGreaterThanOrEqual(1)
    const initialCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]
    const renderCountBefore = capturedCallbacksByRender.length

    // Simulate a cell edit — syncCellValue updates the store's editState and rows
    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'Alice2')
    })

    // ResultGridView should have been re-rendered with updated data
    expect(capturedCallbacksByRender.length).toBeGreaterThan(renderCountBefore)
    const latestCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]

    // CRITICAL: callback references must be the SAME objects across renders.
    // If they change, column definitions re-compute, renderEditCell changes,
    // and the editor component is unmounted → focus lost.
    expect(latestCallbacks.onUpdateCellValue).toBe(initialCallbacks.onUpdateCellValue)
  })

  it('onSyncCellValue reference stays stable after a cell value is synced to the store', () => {
    renderWithActiveEditing()

    const initialCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]
    const renderCountBefore = capturedCallbacksByRender.length

    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'Alice2')
    })

    expect(capturedCallbacksByRender.length).toBeGreaterThan(renderCountBefore)
    const latestCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]

    expect(latestCallbacks.onSyncCellValue).toBe(initialCallbacks.onSyncCellValue)
  })

  it('onAutoSave reference stays stable after a cell value is synced to the store', () => {
    renderWithActiveEditing()

    const initialCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]
    const renderCountBefore = capturedCallbacksByRender.length

    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'Alice2')
    })

    expect(capturedCallbacksByRender.length).toBeGreaterThan(renderCountBefore)
    const latestCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]

    expect(latestCallbacks.onAutoSave).toBe(initialCallbacks.onAutoSave)
  })

  it('onStartEditing reference stays stable after a cell value is synced to the store', () => {
    renderWithActiveEditing()

    const initialCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]
    const renderCountBefore = capturedCallbacksByRender.length

    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'Alice2')
    })

    expect(capturedCallbacksByRender.length).toBeGreaterThan(renderCountBefore)
    const latestCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]

    expect(latestCallbacks.onStartEditing).toBe(initialCallbacks.onStartEditing)
  })

  it('callbacks remain stable across multiple consecutive cell edits', () => {
    renderWithActiveEditing()

    const initialCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]

    // Simulate typing multiple characters one by one
    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'A')
    })
    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'Al')
    })
    act(() => {
      useQueryStore.getState().syncCellValue('tab-1', 1, 'Ali')
    })

    const latestCallbacks = capturedCallbacksByRender[capturedCallbacksByRender.length - 1]

    expect(latestCallbacks.onUpdateCellValue).toBe(initialCallbacks.onUpdateCellValue)
    expect(latestCallbacks.onSyncCellValue).toBe(initialCallbacks.onSyncCellValue)
    expect(latestCallbacks.onAutoSave).toBe(initialCallbacks.onAutoSave)
    expect(latestCallbacks.onStartEditing).toBe(initialCallbacks.onStartEditing)
  })
})
