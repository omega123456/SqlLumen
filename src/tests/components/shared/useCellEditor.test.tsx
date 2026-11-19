import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TableDataColumnMeta } from '../../../types/schema'
import { useCellEditor } from '../../../components/shared/useCellEditor'
import type { CellEditorParams } from '../../../components/shared/useCellEditor'
import type { EditorCallbacksContextType } from '../../../components/shared/editor-callbacks-context'

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
  const { inputRef, isNull, value, handleChange, handleToggleNull, restoreOriginalValue } =
    useCellEditor(props.params, TEST_EDITOR_CALLBACKS)
  return (
    <div>
      <input
        ref={inputRef}
        value={isNull ? '' : (value ?? '')}
        onChange={(e) => handleChange(e.target.value)}
        data-testid="test-input"
      />
      <button onClick={handleToggleNull} data-testid="toggle-null">
        NULL
      </button>
      <button onClick={restoreOriginalValue} data-testid="restore">
        Restore
      </button>
      <span data-testid="is-null">{String(isNull)}</span>
      <span data-testid="value">{String(value)}</span>
    </div>
  )
}

const editedCellValues: Record<string, unknown> = {}

function recordEditedCellValue(_tabId: string, column: string, value: unknown) {
  editedCellValues[column] = value
}

function ignoreCellSync() {}

const TEST_EDITOR_CALLBACKS: EditorCallbacksContextType = {
  tabId: 'tab-1',
  updateCellValue: recordEditedCellValue,
  syncCellValue: ignoreCellSync,
}

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

describe('useCellEditor', () => {
  it('initializes with the provided value', () => {
    const params = makeMockParams()
    render(<TestEditor params={params} />)

    expect(getEditorValue()).toBe('2023-11-24')
    expect(screen.getByTestId('is-null')).toHaveTextContent('false')
  })

  it('initializes as null when row value is null', () => {
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    expect(getEditorValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })

  it('auto-focuses input on mount', () => {
    render(<TestEditor params={makeMockParams()} />)
    expect(screen.getByTestId('test-input')).toHaveFocus()
  })

  it('handleChange updates value and syncs to store', () => {
    render(<TestEditor params={makeMockParams()} />)

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(getEditorValue()).toBe('2024-01-01 12:00:00')

    expect(editedCellValues.created_at).toBe('2024-01-01 12:00:00')
  })

  it('handleChange calls onRowChange to preview value in grid', () => {
    const params = makeMockParams()
    render(<TestEditor params={params} />)

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01 12:00:00' } })

    expect(params.onRowChange).toHaveBeenCalledWith({ id: 1, created_at: '2024-01-01 12:00:00' })
  })

  it('handleChange clears null state when typing', () => {
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    expect(getEditorValue()).toBeNull()

    const input = screen.getByTestId('test-input')
    fireEvent.change(input, { target: { value: '2024-01-01' } })

    expect(getEditorValue()).toBe('2024-01-01')
    expect(screen.getByTestId('is-null')).toHaveTextContent('false')
  })

  it('handleToggleNull: toggle on sets value to null', () => {
    render(<TestEditor params={makeMockParams()} />)

    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(getEditorValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })

  it('handleToggleNull: toggle off prefills temporal with today', () => {
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    // Start as null, toggle off
    fireEvent.click(screen.getByTestId('toggle-null'))

    expect(getEditorValue()).toBe('2025-06-15 11:00:00')
  })

  it('handleToggleNull: toggle off for non-temporal sets empty string', () => {
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
    const params = makeMockParams({ row: { id: 1, created_at: null } })
    render(<TestEditor params={params} />)

    // Toggle null off (sets a value)
    fireEvent.click(screen.getByTestId('toggle-null'))
    expect(getEditorValue()).toBe('2025-06-15 11:00:00')

    // Restore
    fireEvent.click(screen.getByTestId('restore'))

    expect(getEditorValue()).toBeNull()
    expect(screen.getByTestId('is-null')).toHaveTextContent('true')
  })
})
