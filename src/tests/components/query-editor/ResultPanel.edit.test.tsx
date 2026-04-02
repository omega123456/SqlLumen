/**
 * Tests for ResultPanel edit mode callback wiring.
 *
 * Uses a different mocking strategy than ResultPanel.test.tsx:
 * ResultGridView is mocked to capture callback props and invoke them directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore, type TabQueryState } from '../../../stores/query-store'

// Store captured ResultGridView props for test assertions
let capturedGridProps: Record<string, unknown> = {}

// Mock ResultGridView to capture its props
vi.mock('../../../components/query-editor/ResultGridView', () => ({
  ResultGridView: vi.fn((props: Record<string, unknown>) => {
    const React = require('react')
    capturedGridProps = props
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
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  capturedGridProps = {}
  mockIPC(() => null)
})

describe('ResultPanel edit mode callbacks', () => {
  function renderWithEditState() {
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
          rows: [['1', 'Alice']],
          totalRows: 1,
          queryId: 'q1',
          editMode: 'users',
          editableColumnMap: new Map([
            [0, false],
            [1, true],
          ]),
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
  }

  it('passes onStartEditing that calls store.startEditingRow', () => {
    const startEditingRowSpy = vi.spyOn(useQueryStore.getState(), 'startEditingRow')
    renderWithEditState()

    const onStartEditing = capturedGridProps.onStartEditing as (rowIndex: number) => void
    expect(onStartEditing).toBeDefined()
    onStartEditing(0)

    expect(startEditingRowSpy).toHaveBeenCalledWith('tab-1', 0)
    startEditingRowSpy.mockRestore()
  })

  it('passes onUpdateCellValue that calls store.updateCellValue', () => {
    const updateCellValueSpy = vi.spyOn(useQueryStore.getState(), 'updateCellValue')
    renderWithEditState()

    const onUpdateCellValue = capturedGridProps.onUpdateCellValue as (
      columnIndex: number,
      value: unknown
    ) => void
    expect(onUpdateCellValue).toBeDefined()
    onUpdateCellValue(1, 'Bob')

    expect(updateCellValueSpy).toHaveBeenCalledWith('tab-1', 1, 'Bob')
    updateCellValueSpy.mockRestore()
  })

  it('passes onSyncCellValue that calls store.syncCellValue', () => {
    const syncCellValueSpy = vi.spyOn(useQueryStore.getState(), 'syncCellValue')
    renderWithEditState()

    const onSyncCellValue = capturedGridProps.onSyncCellValue as (
      columnIndex: number,
      value: unknown
    ) => void
    expect(onSyncCellValue).toBeDefined()
    onSyncCellValue(1, 'Charlie')

    expect(syncCellValueSpy).toHaveBeenCalledWith('tab-1', 1, 'Charlie')
    syncCellValueSpy.mockRestore()
  })

  it('passes onAutoSave that calls store.saveCurrentRow and returns success state', async () => {
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockResolvedValue(true)
    renderWithEditState()

    const onAutoSave = capturedGridProps.onAutoSave as () => Promise<boolean>
    expect(onAutoSave).toBeDefined()

    let result: boolean
    await act(async () => {
      result = await onAutoSave()
    })

    expect(saveCurrentRowSpy).toHaveBeenCalledWith('tab-1')
    // No saveError set, so should return true
    expect(result!).toBe(true)
    saveCurrentRowSpy.mockRestore()
  })

  it('onAutoSave returns false when saveError is set', async () => {
    const saveCurrentRowSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockResolvedValue(false)
    renderWithEditState()

    const onAutoSave = capturedGridProps.onAutoSave as () => Promise<boolean>

    let result: boolean
    await act(async () => {
      result = await onAutoSave()
    })

    expect(result!).toBe(false)
    saveCurrentRowSpy.mockRestore()
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
        'tab-1': {
          ...DEFAULT_TAB_STATE,
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
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)

    expect(capturedGridProps.editState).toBe(editState)
    expect(capturedGridProps.editingRowIndex).toBe(0)
  })
})
