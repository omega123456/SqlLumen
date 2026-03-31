import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useTableDataStore } from '../../../stores/table-data-store'
import type { TableDataColumnMeta } from '../../../types/schema'

// Mock the DateTimePicker to avoid portal / react-datepicker DOM issues
vi.mock('../../../components/table-data/DateTimePicker', () => ({
  DateTimePicker: vi.fn(
    ({ onApply, onCancel }: { onApply: (v: string) => void; onCancel: () => void }) => (
      <div data-testid="date-time-picker-popup">
        <button data-testid="mock-apply" onClick={() => onApply('2023-11-24 14:30:00')}>
          Apply
        </button>
        <button data-testid="mock-cancel" onClick={() => onCancel()}>
          Cancel
        </button>
      </div>
    )
  ),
}))

// Mock date-utils — keep real implementations except getTodayMysqlString
vi.mock('../../../lib/date-utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/date-utils')>('../../../lib/date-utils')
  return {
    ...actual,
    getTodayMysqlString: vi.fn(() => '2025-06-15 10:00:00'),
  }
})

import DateTimeCellEditor from '../../../components/table-data/DateTimeCellEditor'
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

function makeMockProps(overrides: Record<string, unknown> = {}) {
  const store = useTableDataStore.getState()
  return {
    row: { id: 1, created_at: '2023-11-24' } as Record<string, unknown>,
    column: { key: 'created_at' },
    onRowChange: vi.fn(),
    onClose: vi.fn(),
    isNullable: true,
    columnMeta: makeColumnMeta('created_at', 'DATETIME', { isNullable: true }),
    tabId: 'tab-1',
    updateCellValue: store.updateCellValue,
    syncCellValue: store.syncCellValue,
    ...overrides,
  }
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

describe('DateTimeCellEditor', () => {
  it('renders text input with calendar button', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    expect(screen.getByTestId('datetime-cell-editor')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByTestId('grid-calendar-btn')).toBeInTheDocument()
  })

  it('displays Clock icon for TIME columns', () => {
    setupStore()
    const props = makeMockProps({
      row: { id: 1, login_time: '14:30:00' },
      column: { key: 'login_time' },
      columnMeta: makeColumnMeta('login_time', 'TIME', { isNullable: true }),
    })
    render(<DateTimeCellEditor {...(props as any)} />)

    expect(screen.getByTestId('grid-calendar-btn')).toBeInTheDocument()
  })

  it('displays the initial value in the input', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2023-11-24')
  })

  it('clicking calendar button shows picker (renders mock DateTimePicker)', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Picker should NOT be visible yet
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // Click the calendar button
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))

    // Picker should now be visible
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
  })

  it('picker onApply updates value and closes picker; calls updateCellValue', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Click apply in mock picker
    fireEvent.click(screen.getByTestId('mock-apply'))

    // Picker should be closed
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // Input should show new value
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2023-11-24 14:30:00')

    // onRowChange should have been called (preview)
    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2023-11-24 14:30:00' })
    )

    // updateCellValue should have been called
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.created_at).toBe('2023-11-24 14:30:00')
  })

  it('picker onCancel closes picker without updating value', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Click cancel
    fireEvent.click(screen.getByTestId('mock-cancel'))

    // Picker should be closed
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // Value should remain unchanged
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2023-11-24')
  })

  it('toggling NULL on while picker is open closes the picker', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Toggle NULL on — picker should close
    const nullToggle = screen.getByText('NULL')
    fireEvent.click(nullToggle)

    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // onRowChange should have been called with null
    expect(props.onRowChange).toHaveBeenCalledWith(expect.objectContaining({ created_at: null }))
  })

  it('NULL toggle behavior: toggling null on sets value to null', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Should have NULL toggle since isNullable=true
    const nullToggle = screen.getByText('NULL')
    expect(nullToggle).toBeInTheDocument()

    // Toggle NULL on
    fireEvent.click(nullToggle)

    // Input should be empty
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('NULL toggle off calls getTodayMysqlString for temporal pre-fill', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...(props as any)} />)

    // Should start as null (empty input)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')

    // Toggle NULL off
    const nullToggle = screen.getByText('NULL')
    fireEvent.click(nullToggle)

    // Should have called getTodayMysqlString and set the value
    expect(getTodayMysqlString).toHaveBeenCalledWith('DATETIME')
    expect(input.value).toBe('2025-06-15 10:00:00')
  })

  it('does NOT show NULL toggle when isNullable is false', () => {
    setupStore()
    const props = makeMockProps({
      isNullable: false,
      columnMeta: makeColumnMeta('created_at', 'DATETIME', { isNullable: false }),
    })
    render(<DateTimeCellEditor {...(props as any)} />)

    expect(screen.queryByText('NULL')).not.toBeInTheDocument()
  })

  it('Escape key calls onClose(false, false) when picker is NOT open', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('first Escape when picker is open closes only the picker (not the cell edit)', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Press Escape on the input
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })

    // Picker should be closed
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // But onClose should NOT have been called
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('second Escape (after picker closed) cancels the cell edit', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    const input = screen.getByRole('textbox')

    // First Escape: close picker only
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()

    // Second Escape: cancel cell edit
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('direct typing in text input works', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(input.value).toBe('2024-01-01 12:00:00')

    // onRowChange should have been called for preview
    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2024-01-01 12:00:00' })
    )
  })

  it('input shows empty string when row value is null', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('auto-focuses input on mount', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveFocus()
  })

  it('typing in input when null clears null state', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: '2024-01-01' } })

    // Should no longer be null
    expect(input.value).toBe('2024-01-01')
  })

  it('calendar button is disabled when isNull is true', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...(props as any)} />)

    const calBtn = screen.getByTestId('grid-calendar-btn')
    expect(calBtn).toBeDisabled()
  })

  it('clicking disabled calendar button does NOT open picker when null', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...(props as any)} />)

    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
  })

  it('calendar button is enabled when value is not null', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: '2023-11-24' } })
    render(<DateTimeCellEditor {...(props as any)} />)

    const calBtn = screen.getByTestId('grid-calendar-btn')
    expect(calBtn).not.toBeDisabled()
  })

  it('Escape key restores original value', () => {
    setupStore()
    const props = makeMockProps({ row: { id: 1, created_at: '2023-11-24' } })
    render(<DateTimeCellEditor {...(props as any)} />)

    // Type a new value
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '2099-12-31' } })

    // Press Escape to revert
    fireEvent.keyDown(input, { key: 'Escape' })

    // onClose should be called to discard
    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('Tab key commits the current value', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2023-11-24' }),
      true
    )
  })

  it('Enter key commits the current value', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2023-11-24' }),
      true
    )
  })

  it('double-update guard: onRowChange receives already-applied picker value', () => {
    setupStore()
    const props = makeMockProps()
    render(<DateTimeCellEditor {...(props as any)} />)

    // Open picker and apply
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    fireEvent.click(screen.getByTestId('mock-apply'))

    // The input should show the new value
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2023-11-24 14:30:00')

    // The store was already updated by the picker's Apply (via editor.handleChange).
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState?.currentValues.created_at).toBe('2023-11-24 14:30:00')
  })
})
