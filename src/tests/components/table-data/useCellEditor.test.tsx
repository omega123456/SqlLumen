import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { TableDataColumnMeta } from '../../../types/schema'
import { useCellEditor } from '../../../components/table-data/useCellEditor'
import type {
  CellEditorParams,
  CellEditorCallbacks,
} from '../../../components/table-data/useCellEditor'

// Mock date-utils — keep real implementations except getTodayMysqlString
vi.mock('../../../lib/date-utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/date-utils')>('../../../lib/date-utils')
  return {
    ...actual,
    getTodayMysqlString: vi.fn(() => '2025-06-15 10:00:00'),
  }
})

import { getTodayMysqlString } from '../../../lib/date-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumnMeta(
  name: string,
  dataType: string,
  overrides: Partial<TableDataColumnMeta> = {}
): TableDataColumnMeta {
  return {
    name,
    dataType,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

function makeMockParams(overrides: Partial<CellEditorParams> = {}): CellEditorParams {
  return {
    row: { id: 1, created_at: '2023-11-24' },
    column: { key: 'created_at' },
    onRowChange: vi.fn(),
    onClose: vi.fn(),
    isNullable: true,
    columnMeta: makeColumnMeta('created_at', 'DATETIME', { isNullable: true }),
    ...overrides,
  }
}

/** Helper to get the effective editor value from the test wrapper DOM. */
function getEditorValue(): string | null {
  const isNull = screen.getByTestId('is-null').textContent === 'true'
  if (isNull) return null
  return screen.getByTestId('value').textContent
}

/** Test wrapper component that exposes hook state via the DOM. */
function TestEditor(props: { params: CellEditorParams }) {
  const store = useTableDataStore.getState()
  const callbacks: CellEditorCallbacks = {
    tabId: 'tab-1',
    updateCellValue: store.updateCellValue,
    syncCellValue: store.syncCellValue,
  }
  const editor = useCellEditor(props.params, callbacks)
  return (
    <div>
      <input
        ref={editor.inputRef}
        value={editor.isNull ? '' : (editor.value ?? '')}
        onChange={(e) => editor.handleChange(e.target.value)}
        data-testid="test-input"
      />
      <button onClick={editor.handleToggleNull} data-testid="toggle-null">
        NULL
      </button>
      <button onClick={editor.restoreOriginalValue} data-testid="restore">
        Restore
      </button>
      <span data-testid="is-null">{String(editor.isNull)}</span>
      <span data-testid="value">{String(editor.value)}</span>
    </div>
  )
}

function setupStore() {
  useTableDataStore.setState({
    tabs: {
      'tab-1': {
        columns: [
          makeColumnMeta('id', 'BIGINT', { isPrimaryKey: true }),
          makeColumnMeta('created_at', 'DATETIME', { isNullable: true }),
        ],
        rows: [[1, '2023-11-24 14:30:00']],
        totalRows: 1,
        currentPage: 1,
        totalPages: 1,
        pageSize: 1000,
        primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
        executionTimeMs: 10,
        connectionId: 'conn-1',
        database: 'mydb',
        table: 'users',
        editState: {
          rowKey: { id: 1 },
          originalValues: { id: 1, created_at: '2023-11-24' },
          currentValues: { id: 1, created_at: '2023-11-24' },
          modifiedColumns: new Set(),
          isNewRow: false,
        },
        viewMode: 'grid',
        selectedRowKey: null,
        filterModel: [],
        sort: null,
        isLoading: false,
        error: null,
        saveError: null,
        isExportDialogOpen: false,
        pendingNavigationAction: null,
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  useTableDataStore.setState({ tabs: {} })
})

describe('useCellEditor', () => {
  it('initializes with the provided value', () => {
    setupStore()
    const params = makeMockParams()
    render(<TestEditor params={params} />)

    expect(getEditorValue()).toBe('2023-11-24')
    expect(screen.getByTestId('is-null')).toHaveTextContent('false')
  })

  it('initializes as null when row value is null', () => {
    setupStore()
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    expect(getEditorValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })

  it('auto-focuses input on mount', () => {
    setupStore()
    render(<TestEditor params={makeMockParams()} />)
    expect(screen.getByTestId('test-input')).toHaveFocus()
  })

  it('handleChange updates value and syncs to store', () => {
    setupStore()
    render(<TestEditor params={makeMockParams()} />)

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(getEditorValue()).toBe('2024-01-01 12:00:00')

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.created_at).toBe('2024-01-01 12:00:00')
  })

  it('handleChange calls onRowChange to preview value in grid', () => {
    setupStore()
    const params = makeMockParams()
    render(<TestEditor params={params} />)

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(params.onRowChange).toHaveBeenCalledWith({ id: 1, created_at: '2024-01-01 12:00:00' })
  })

  it('handleChange clears null state when typing', () => {
    setupStore()
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    expect(getEditorValue()).toBeNull()

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01' } })

    expect(getEditorValue()).toBe('2024-01-01')
    expect(screen.getByTestId('is-null')).toHaveTextContent('false')
  })

  it('handleToggleNull: toggle on sets value to null', () => {
    setupStore()
    render(<TestEditor params={makeMockParams()} />)

    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(getEditorValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })

  it('handleToggleNull: toggle off prefills temporal with today', () => {
    setupStore()
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    // Start as null, toggle off
    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(getTodayMysqlString).toHaveBeenCalledWith('DATETIME')
    expect(getEditorValue()).toBe('2025-06-15 10:00:00')
  })

  it('handleToggleNull: toggle off for non-temporal sets empty string', () => {
    setupStore()
    const params = makeMockParams({
      row: { id: 1, name: null },
      column: { key: 'name' },
      columnMeta: makeColumnMeta('name', 'VARCHAR', { isNullable: true }),
    })
    render(<TestEditor params={params} />)

    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(getEditorValue()).toBe('')
  })

  it('restoreOriginalValue restores to initial state', () => {
    setupStore()
    render(<TestEditor params={makeMockParams()} />)

    // Change value
    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2099-12-31' } })
    expect(getEditorValue()).toBe('2099-12-31')

    // Restore
    fireEvent.click(screen.getByTestId('restore'))

    expect(getEditorValue()).toBe('2023-11-24')
  })

  it('restoreOriginalValue restores null state when initially null', () => {
    setupStore()
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    // Toggle null off (sets a value)
    fireEvent.click(screen.getByTestId('toggle-null'))
    expect(getEditorValue()).toBe('2025-06-15 10:00:00')

    // Restore
    fireEvent.click(screen.getByTestId('restore'))

    expect(getEditorValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })
})
