import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { forwardRef, createRef } from 'react'
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

function makeMockParams(overrides: Record<string, unknown> = {}): CellEditorParams {
  return {
    value: '2023-11-24',
    stopEditing: vi.fn(),
    api: { stopEditing: vi.fn() },
    node: { data: { id: 1 } },
    column: { getColId: () => 'created_at' },
    colDef: { field: 'created_at' },
    context: { tabId: 'tab-1' },
    isNullable: true,
    columnMeta: makeColumnMeta('created_at', 'DATETIME', { isNullable: true }),
    ...overrides,
  } as unknown as CellEditorParams
}

interface EditorHandle {
  getValue: () => unknown
  isCancelBeforeStart: () => boolean
  isCancelAfterEnd: () => boolean
}

/** Test wrapper component that exposes hook state via the DOM. */
const TestEditor = forwardRef(function TestEditor(
  props: { params: CellEditorParams },
  ref: React.ForwardedRef<unknown>
) {
  const store = useTableDataStore.getState()
  const callbacks: CellEditorCallbacks = {
    tabId: ((props.params.context as Record<string, unknown> | undefined)?.tabId as string) ?? '',
    updateCellValue: store.updateCellValue,
    syncCellValue: store.syncCellValue,
  }
  const editor = useCellEditor(props.params, ref, callbacks)
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
})

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
        filterModel: {},
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
    const ref = createRef<EditorHandle>()
    const params = makeMockParams()
    render(<TestEditor ref={ref} params={params} />)

    expect(ref.current!.getValue()).toBe('2023-11-24')
    expect(screen.getByTestId('is-null')).toHaveTextContent('false')
  })

  it('initializes as null when params.value is null', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    const params = makeMockParams({ value: null })
    render(<TestEditor ref={ref} params={params} />)

    expect(ref.current!.getValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })

  it('isCancelBeforeStart returns false', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    render(<TestEditor ref={ref} params={makeMockParams()} />)
    expect(ref.current!.isCancelBeforeStart()).toBe(false)
  })

  it('isCancelAfterEnd returns false', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    render(<TestEditor ref={ref} params={makeMockParams()} />)
    expect(ref.current!.isCancelAfterEnd()).toBe(false)
  })

  it('auto-focuses input on mount', () => {
    setupStore()
    render(<TestEditor ref={createRef()} params={makeMockParams()} />)
    expect(screen.getByTestId('test-input')).toHaveFocus()
  })

  it('handleChange updates value and syncs to store', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    render(<TestEditor ref={ref} params={makeMockParams()} />)

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(ref.current!.getValue()).toBe('2024-01-01 12:00:00')

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.created_at).toBe('2024-01-01 12:00:00')
  })

  it('handleChange clears null state when typing', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    const params = makeMockParams({ value: null })
    render(<TestEditor ref={ref} params={params} />)

    expect(ref.current!.getValue()).toBeNull()

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01' } })

    expect(ref.current!.getValue()).toBe('2024-01-01')
    expect(screen.getByTestId('is-null')).toHaveTextContent('false')
  })

  it('handleToggleNull: toggle on sets value to null', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    render(<TestEditor ref={ref} params={makeMockParams()} />)

    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(ref.current!.getValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })

  it('handleToggleNull: toggle off prefills temporal with today', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    const params = makeMockParams({ value: null })
    render(<TestEditor ref={ref} params={params} />)

    // Start as null, toggle off
    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(getTodayMysqlString).toHaveBeenCalledWith('DATETIME')
    expect(ref.current!.getValue()).toBe('2025-06-15 10:00:00')
  })

  it('handleToggleNull: toggle off for non-temporal sets empty string', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    const params = makeMockParams({
      value: null,
      columnMeta: makeColumnMeta('name', 'VARCHAR', { isNullable: true }),
      colDef: { field: 'name' },
    })
    render(<TestEditor ref={ref} params={params} />)

    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(ref.current!.getValue()).toBe('')
  })

  it('restoreOriginalValue restores to initial state', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    render(<TestEditor ref={ref} params={makeMockParams()} />)

    // Change value
    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2099-12-31' } })
    expect(ref.current!.getValue()).toBe('2099-12-31')

    // Restore
    fireEvent.click(screen.getByTestId('restore'))

    expect(ref.current!.getValue()).toBe('2023-11-24')
  })

  it('restoreOriginalValue restores null state when initially null', () => {
    setupStore()
    const ref = createRef<EditorHandle>()
    const params = makeMockParams({ value: null })
    render(<TestEditor ref={ref} params={params} />)

    // Toggle null off (sets a value)
    fireEvent.click(screen.getByTestId('toggle-null'))
    expect(ref.current!.getValue()).toBe('2025-06-15 10:00:00')

    // Restore
    fireEvent.click(screen.getByTestId('restore'))

    expect(ref.current!.getValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })
})
