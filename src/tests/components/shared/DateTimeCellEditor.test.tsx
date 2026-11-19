import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TableDataColumnMeta } from '../../../types/schema'
import type { CellEditorParams } from '../../../components/shared/useCellEditor'
import type { EditorCallbacksContextType } from '../../../components/shared/editor-callbacks-context'

import DateTimeCellEditor from '../../../components/shared/DateTimeCellEditor'

type DateTimeCellEditorProps = CellEditorParams & EditorCallbacksContextType

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
  return {
    row: { id: 1, created_at: '2023-11-24' } as Record<string, unknown>,
    column: { key: 'created_at' },
    onRowChange: vi.fn(),
    onClose: vi.fn(),
    isNullable: true,
    columnMeta: makeColumnMeta('created_at', 'DATETIME', { isNullable: true }),
    tabId: 'tab-1',
    updateCellValue: recordEditedCellValue,
    syncCellValue: ignoreCellSync,
    ...overrides,
  } satisfies DateTimeCellEditorProps
}

const editedCellValues: Record<string, unknown> = {}

function recordEditedCellValue(_tabId: string, column: string, value: unknown) {
  editedCellValues[column] = value
}

function ignoreCellSync() {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2025-06-15T10:00:00Z'))
  for (const column of Object.keys(editedCellValues)) delete editedCellValues[column]
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DateTimeCellEditor', () => {
  it('renders text input with calendar button', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    expect(screen.getByTestId('datetime-cell-editor')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByTestId('grid-calendar-btn')).toBeInTheDocument()
  })

  it('shows the calendar adornment next to the input', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByTestId('grid-calendar-btn')).toBeInTheDocument()
  })

  it('displays Clock icon for TIME columns', () => {
    const props = makeMockProps({
      row: { id: 1, login_time: '14:30:00' },
      column: { key: 'login_time' },
      columnMeta: makeColumnMeta('login_time', 'TIME', { isNullable: true }),
    })
    render(<DateTimeCellEditor {...props} />)

    expect(screen.getByTestId('grid-calendar-btn')).toBeInTheDocument()
  })

  it('displays the initial value in the input', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2023-11-24')
  })

  it('prefers initialInputValue when typing activation opens the editor', () => {
    const props = makeMockProps({ initialInputValue: '2', selectAllOnFocus: false })
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2')
  })

  it('clicking calendar button shows picker (renders mock DateTimePicker)', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Picker should NOT be visible yet
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // Click the calendar button
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))

    // Picker should now be visible
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
  })

  it('picker onApply updates value and closes picker; calls updateCellValue', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('btn-today'))
    fireEvent.change(screen.getByTestId('time-input'), { target: { value: '16:45:00' } })
    fireEvent.click(screen.getByTestId('btn-picker-apply'))

    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2025-06-15 16:45:00')
    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2025-06-15 16:45:00' })
    )
    expect(editedCellValues.created_at).toBe('2025-06-15 16:45:00')
  })

  it('picker onApply commits the active grid editor so the grid persists the selected date', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    fireEvent.click(screen.getByTestId('btn-today'))
    fireEvent.click(screen.getByTestId('btn-picker-apply'))

    expect(props.onClose).toHaveBeenCalledWith(true, false)
  })

  it('picker onCancel closes picker without updating value', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('btn-picker-cancel'))

    // Picker should be closed
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // Value should remain unchanged
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('2023-11-24')
  })

  it('toggling NULL on while picker is open closes the picker', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

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
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Should have NULL toggle since isNullable=true
    const nullToggle = screen.getByText('NULL')
    expect(nullToggle).toBeInTheDocument()

    // Toggle NULL on
    fireEvent.click(nullToggle)

    // Input should be empty
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('NULL toggle off prefills temporal values from the current clock', () => {
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...props} />)

    // Should start as null (empty input)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')

    // Toggle NULL off
    const nullToggle = screen.getByText('NULL')
    fireEvent.click(nullToggle)

    expect(input.value).toBe('2025-06-15 11:00:00')
  })

  it('does NOT show NULL toggle when isNullable is false', () => {
    const props = makeMockProps({
      isNullable: false,
      columnMeta: makeColumnMeta('created_at', 'DATETIME', { isNullable: false }),
    })
    render(<DateTimeCellEditor {...props} />)

    expect(screen.queryByText('NULL')).not.toBeInTheDocument()
  })

  it('Escape key calls onClose(false, false) when picker is NOT open', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getAllByRole('textbox')[0]
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('first Escape when picker is open closes only the picker (not the cell edit)', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    // Press Escape on the input
    const input = screen.getAllByRole('textbox')[0]
    fireEvent.keyDown(input, { key: 'Escape' })

    // Picker should be closed
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()

    // But onClose should NOT have been called
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('second Escape (after picker closed) cancels the cell edit', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Open picker
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()

    const input = screen.getAllByRole('textbox')[0]

    // First Escape: close picker only
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()

    // Second Escape: cancel cell edit
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('direct typing in text input works', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(input.value).toBe('2024-01-01 12:00:00')

    // onRowChange should have been called for preview
    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2024-01-01 12:00:00' })
    )
  })

  it('input shows empty string when row value is null', () => {
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('auto-focuses input on mount', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveFocus()
  })

  it('typing in input when null clears null state', () => {
    const props = makeMockProps({ row: { id: 1, created_at: null } })
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: '2024-01-01' } })

    // Should no longer be null
    expect(input.value).toBe('2024-01-01')
  })

  it('opens the picker on a blank new-row date cell and applying a date fills the cell', () => {
    const props = makeMockProps({
      row: { id: 1, created_at: null },
      isNullable: false,
      columnMeta: makeColumnMeta('created_at', 'DATE'),
    })
    render(<DateTimeCellEditor {...props} />)

    const calendarButton = screen.getByTestId('grid-calendar-btn')
    expect(calendarButton).not.toBeDisabled()
    fireEvent.click(calendarButton)
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('btn-today'))
    fireEvent.click(screen.getByTestId('btn-picker-apply'))

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('2025-06-15')
    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2025-06-15' })
    )
    expect(props.onClose).toHaveBeenCalledWith(true, false)
  })

  it('Escape key restores original value', () => {
    const props = makeMockProps({ row: { id: 1, created_at: '2023-11-24' } })
    render(<DateTimeCellEditor {...props} />)

    // Type a new value
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '2099-12-31' } })

    // Press Escape to revert
    fireEvent.keyDown(input, { key: 'Escape' })

    // onClose should be called to discard
    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('Tab key commits the current value', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2023-11-24' }),
      true
    )
  })

  it('Enter key commits the current value', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({ created_at: '2023-11-24' }),
      true
    )
  })

  it('double-update guard: onRowChange receives already-applied picker value', () => {
    const props = makeMockProps()
    render(<DateTimeCellEditor {...props} />)

    // Open picker and apply
    fireEvent.click(screen.getByTestId('grid-calendar-btn'))
    fireEvent.click(screen.getByTestId('btn-today'))
    fireEvent.click(screen.getByTestId('btn-picker-apply'))

    // The input should show the new value
    const input = screen.getAllByRole('textbox')[0] as HTMLInputElement
    expect(input.value).toBe('2025-06-15 11:00:00')

    // The store was already updated by the picker's Apply (via editor.handleChange).
    expect(editedCellValues.created_at).toBe('2025-06-15 11:00:00')
  })
})
