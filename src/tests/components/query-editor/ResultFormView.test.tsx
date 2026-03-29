import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResultFormView } from '../../../components/query-editor/ResultFormView'
import { useQueryStore } from '../../../stores/query-store'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../../types/schema'

// Mock the clipboard utility
const mockWriteClipboardText = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}))

const columns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'name', dataType: 'VARCHAR' },
  { name: 'email', dataType: 'VARCHAR' },
]

const rows: unknown[][] = [
  [1, 'Alice', 'alice@example.com'],
  [2, 'Bob', null],
  [3, 'Charlie', 'charlie@example.com'],
  [4, 'Dave', 'dave@example.com'],
  [5, null, 'eve@example.com'],
]

const defaultProps = {
  columns,
  rows,
  selectedRowIndex: 0 as number | null,
  totalRows: 5,
  currentPage: 1,
  totalPages: 1,
  onNavigate: vi.fn(),
  tabId: 'tab-1',
}

/** Helper to build a complete tab state for the query store. */
function buildTabState(overrides: Record<string, unknown> = {}) {
  return {
    content: '',
    filePath: null,
    status: 'success' as const,
    columns,
    rows,
    totalRows: 5,
    executionTimeMs: 10,
    affectedRows: 0,
    queryId: 'q1',
    currentPage: 1,
    totalPages: 1,
    pageSize: 1000,
    autoLimitApplied: false,
    errorMessage: null,
    cursorPosition: null,
    viewMode: 'form' as const,
    sortColumn: null,
    sortDirection: null,
    selectedRowIndex: 0,
    exportDialogOpen: false,
    lastExecutedSql: null,
    editMode: null,
    editTableMetadata: {},
    editState: null,
    isAnalyzingQuery: false,
    editableColumnMap: new Map<number, boolean>(),
    pendingNavigationAction: null,
    saveError: null,
    editConnectionId: null,
    editingRowIndex: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIPC(() => null)
  // Set up query store with tab state (so pageSize is accessible)
  useQueryStore.setState({
    tabs: {
      'tab-1': buildTabState(),
    },
  })
})

describe('ResultFormView', () => {
  it('renders with data-testid="result-form-view"', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.getByTestId('result-form-view')).toBeInTheDocument()
  })

  it('shows "Record 1 of 5" heading when selectedRowIndex is 0', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    expect(screen.getByText('Record 1 of 5')).toBeInTheDocument()
  })

  it('shows "Record 3 of 5" heading when selectedRowIndex is 2', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByText('Record 3 of 5')).toBeInTheDocument()
  })

  it('defaults to first record when selectedRowIndex is null', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={null} />)
    expect(screen.getByText('Record 1 of 5')).toBeInTheDocument()
  })

  it('shows all column names as uppercase labels', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('NAME')).toBeInTheDocument()
    expect(screen.getByText('EMAIL')).toBeInTheDocument()
  })

  it('shows all values for the selected row', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    expect(screen.getByTestId('field-value-0')).toHaveTextContent('1')
    expect(screen.getByTestId('field-value-1')).toHaveTextContent('Alice')
    expect(screen.getByTestId('field-value-2')).toHaveTextContent('alice@example.com')
  })

  it('shows NULL as italic "NULL" for null values', () => {
    // Row index 1: [2, 'Bob', null] — email is null
    render(<ResultFormView {...defaultProps} selectedRowIndex={1} />)
    const emailField = screen.getByTestId('field-value-2')
    expect(emailField).toHaveTextContent('NULL')
    // Check that it has the null styling class
    expect(emailField.className).toContain('nullValue')
  })

  it('shows NULL for undefined values', () => {
    // Row index 4: [5, null, 'eve@example.com'] — name is null
    render(<ResultFormView {...defaultProps} selectedRowIndex={4} />)
    const nameField = screen.getByTestId('field-value-1')
    expect(nameField).toHaveTextContent('NULL')
    expect(nameField.className).toContain('nullValue')
  })

  it('Previous button calls onNavigate("prev")', () => {
    const onNavigate = vi.fn()
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByTestId('prev-record-button'))
    expect(onNavigate).toHaveBeenCalledWith('prev')
  })

  it('Next button calls onNavigate("next")', () => {
    const onNavigate = vi.fn()
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByTestId('next-record-button'))
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('Previous button is disabled on first record', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    expect(screen.getByTestId('prev-record-button')).toBeDisabled()
  })

  it('Next button is disabled on last record', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={4} />)
    expect(screen.getByTestId('next-record-button')).toBeDisabled()
  })

  it('both navigation buttons enabled for middle records', () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByTestId('prev-record-button')).not.toBeDisabled()
    expect(screen.getByTestId('next-record-button')).not.toBeDisabled()
  })

  it('copy button calls writeClipboardText with field value', async () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={0} />)
    fireEvent.click(screen.getByTestId('copy-field-1'))
    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith('Alice')
    })
  })

  it('copy button copies "NULL" for null values', async () => {
    render(<ResultFormView {...defaultProps} selectedRowIndex={1} />)
    // email field (index 2) is null for row 1
    fireEvent.click(screen.getByTestId('copy-field-2'))
    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith('NULL')
    })
  })

  it('renders with empty rows without crashing', () => {
    render(<ResultFormView {...defaultProps} rows={[]} totalRows={0} />)
    expect(screen.getByTestId('result-form-view')).toBeInTheDocument()
    expect(screen.getByText('Record 1 of 0')).toBeInTheDocument()
  })

  it('shows correct values for different selected rows', () => {
    // Select row 2 (Charlie)
    render(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByTestId('field-value-0')).toHaveTextContent('3')
    expect(screen.getByTestId('field-value-1')).toHaveTextContent('Charlie')
    expect(screen.getByTestId('field-value-2')).toHaveTextContent('charlie@example.com')
  })

  it('has copy buttons for all fields', () => {
    render(<ResultFormView {...defaultProps} />)
    columns.forEach((_, i) => {
      expect(screen.getByTestId(`copy-field-${i}`)).toBeInTheDocument()
    })
  })

  it('has aria-labels on navigation buttons', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.getByLabelText('Previous record')).toBeInTheDocument()
    expect(screen.getByLabelText('Next record')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Edit Mode Tests
// ---------------------------------------------------------------------------

const editTableColumns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
    isBooleanAlias: false,
    enumValues: undefined,
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
    enumValues: undefined,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'email',
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    enumValues: undefined,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

// Only 'name' (col 1) and 'email' (col 2) are editable; 'id' (col 0) is not
const editableColumnMap = new Map<number, boolean>([
  [0, false],
  [1, true],
  [2, true],
])

const baseEditState: RowEditState = {
  rowKey: { id: 1 },
  originalValues: { name: 'Alice', email: 'alice@example.com' },
  currentValues: { name: 'Alice', email: 'alice@example.com' },
  modifiedColumns: new Set<string>(),
  isNewRow: false,
}

function buildEditProps(overrides: Record<string, unknown> = {}) {
  return {
    editMode: 'users' as string | null,
    editableColumnMap,
    editState: baseEditState as RowEditState | null,
    editingRowIndex: 0 as number | null,
    editTableColumns,
    onStartEdit: vi.fn(),
    onUpdateCell: vi.fn(),
    onSaveRow: vi.fn().mockResolvedValue(true),
    onDiscardRow: vi.fn(),
    ...overrides,
  }
}

describe('ResultFormView — Edit Mode', () => {
  it('renders editable inputs for editable columns when edit mode is active', () => {
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    // 'name' (index 1) and 'email' (index 2) should be inputs
    expect(screen.getByTestId('form-input-1')).toBeInTheDocument()
    expect(screen.getByTestId('form-input-2')).toBeInTheDocument()
    // 'id' (index 0) should be read-only (field-value)
    expect(screen.getByTestId('field-value-0')).toBeInTheDocument()
  })

  it('renders lock icon on non-editable columns', () => {
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    expect(screen.getByTestId('lock-icon-0')).toBeInTheDocument()
    // Editable columns should not have lock icons
    expect(screen.queryByTestId('lock-icon-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lock-icon-2')).not.toBeInTheDocument()
  })

  it('applies non-editable dimming class to non-editable fields', () => {
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    const field0 = screen.getByTestId('form-field-0')
    expect(field0.className).toContain('fieldNonEditable')
    const field1 = screen.getByTestId('form-field-1')
    expect(field1.className).not.toContain('fieldNonEditable')
  })

  it('populates editable inputs with current values', () => {
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    const nameInput = screen.getByTestId('form-input-1') as HTMLInputElement
    expect(nameInput.value).toBe('Alice')
    const emailInput = screen.getByTestId('form-input-2') as HTMLInputElement
    expect(emailInput.value).toBe('alice@example.com')
  })

  it('calls onUpdateCell when input value changes', () => {
    const onUpdateCell = vi.fn()
    render(<ResultFormView {...defaultProps} {...buildEditProps({ onUpdateCell })} />)
    fireEvent.change(screen.getByTestId('form-input-1'), { target: { value: 'Bob' } })
    expect(onUpdateCell).toHaveBeenCalledWith('name', 'Bob')
  })

  it('calls onStartEdit when editable input receives focus', () => {
    const onStartEdit = vi.fn()
    render(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ onStartEdit, editState: null, editingRowIndex: null })}
      />
    )
    fireEvent.focus(screen.getByTestId('form-input-1'))
    expect(onStartEdit).toHaveBeenCalledWith(0)
  })

  it('shows NULL toggle for nullable editable columns', () => {
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    // 'name' (index 1) is nullable — should have NULL toggle
    expect(screen.getByTestId('null-toggle-1')).toBeInTheDocument()
    // 'email' (index 2) is nullable — should have NULL toggle
    expect(screen.getByTestId('null-toggle-2')).toBeInTheDocument()
    // 'id' (index 0) is not editable — should NOT have NULL toggle
    expect(screen.queryByTestId('null-toggle-0')).not.toBeInTheDocument()
  })

  it('NULL toggle calls onUpdateCell with null when value is non-null', () => {
    const onUpdateCell = vi.fn()
    render(<ResultFormView {...defaultProps} {...buildEditProps({ onUpdateCell })} />)
    fireEvent.click(screen.getByTestId('null-toggle-1'))
    expect(onUpdateCell).toHaveBeenCalledWith('name', null)
  })

  it('NULL toggle calls onUpdateCell with empty string when value is null', () => {
    const onUpdateCell = vi.fn()
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: null, email: 'alice@example.com' },
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState, onUpdateCell })} />)
    fireEvent.click(screen.getByTestId('null-toggle-1'))
    // Toggling NULL off should set to empty string
    expect(onUpdateCell).toHaveBeenCalledWith('name', '')
  })

  it('shows modified indicator when a column is modified', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    expect(screen.getByTestId('modified-indicator-1')).toBeInTheDocument()
    expect(screen.getByTestId('modified-note-1')).toBeInTheDocument()
    expect(screen.getByTestId('modified-note-1')).toHaveTextContent('Unsaved change detected')
    // Unmodified column should not have indicator
    expect(screen.queryByTestId('modified-indicator-2')).not.toBeInTheDocument()
  })

  it('shows Save/Discard buttons when edits are pending', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    expect(screen.getByTestId('form-edit-actions')).toBeInTheDocument()
    expect(screen.getByTestId('form-save-button')).toBeInTheDocument()
    expect(screen.getByTestId('form-discard-button')).toBeInTheDocument()
  })

  it('Save button is disabled when no modifications', () => {
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    expect(screen.getByTestId('form-save-button')).toBeDisabled()
  })

  it('Save button is enabled when modifications exist', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    expect(screen.getByTestId('form-save-button')).not.toBeDisabled()
  })

  it('calls onSaveRow when Save button is clicked', async () => {
    const onSaveRow = vi.fn().mockResolvedValue(true)
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState, onSaveRow })} />)
    fireEvent.click(screen.getByTestId('form-save-button'))
    await waitFor(() => {
      expect(onSaveRow).toHaveBeenCalled()
    })
  })

  it('calls onDiscardRow when Discard button is clicked', () => {
    const onDiscardRow = vi.fn()
    render(<ResultFormView {...defaultProps} {...buildEditProps({ onDiscardRow })} />)
    fireEvent.click(screen.getByTestId('form-discard-button'))
    expect(onDiscardRow).toHaveBeenCalled()
  })

  it('auto-saves modifications and navigates in edit mode (not prompt)', async () => {
    const onSaveRow = vi.fn().mockResolvedValue(true)
    const onNavigate = vi.fn()
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    render(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        {...buildEditProps({ onSaveRow, editState })}
      />
    )
    fireEvent.click(screen.getByTestId('next-record-button'))
    // Should auto-save first
    await waitFor(() => expect(onSaveRow).toHaveBeenCalled())
    // Then navigate
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('discards unmodified edit state and navigates directly in edit mode', () => {
    const onDiscardRow = vi.fn()
    const onNavigate = vi.fn()
    render(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        {...buildEditProps({ onDiscardRow })}
      />
    )
    // editState exists but no modifications — should discard and navigate
    fireEvent.click(screen.getByTestId('next-record-button'))
    expect(onDiscardRow).toHaveBeenCalled()
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('stays on record when auto-save fails during navigation', async () => {
    const onSaveRow = vi.fn().mockResolvedValue(false)
    const onNavigate = vi.fn()
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    render(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        {...buildEditProps({ onSaveRow, editState })}
      />
    )
    fireEvent.click(screen.getByTestId('next-record-button'))
    await waitFor(() => expect(onSaveRow).toHaveBeenCalled())
    // Navigation should NOT happen because save failed
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('navigates directly without guard when not in edit mode', () => {
    const onNavigate = vi.fn()
    render(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        editMode={null}
      />
    )
    fireEvent.click(screen.getByTestId('next-record-button'))
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('does not show edit-mode UI when editMode is null', () => {
    render(<ResultFormView {...defaultProps} editMode={null} />)
    // No lock icons
    expect(screen.queryByTestId('lock-icon-0')).not.toBeInTheDocument()
    // No inputs — all fields are read-only values
    expect(screen.queryByTestId('form-input-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('field-value-0')).toBeInTheDocument()
    expect(screen.getByTestId('field-value-1')).toBeInTheDocument()
    // No null toggles
    expect(screen.queryByTestId('null-toggle-1')).not.toBeInTheDocument()
  })

  it('renders enum column as select dropdown', () => {
    const enumTableColumns: TableDataColumnMeta[] = [
      ...editTableColumns.slice(0, 2),
      {
        name: 'email',
        dataType: 'ENUM',
        isBooleanAlias: false,
        enumValues: ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    render(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ editTableColumns: enumTableColumns })}
      />
    )
    const selectEl = screen.getByTestId('form-input-2') as HTMLSelectElement
    expect(selectEl.tagName).toBe('SELECT')
  })

  it('uses edit state values when actively editing the current row', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'EditedName', email: 'edited@example.com' },
      modifiedColumns: new Set(['name', 'email']),
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    const nameInput = screen.getByTestId('form-input-1') as HTMLInputElement
    expect(nameInput.value).toBe('EditedName')
    const emailInput = screen.getByTestId('form-input-2') as HTMLInputElement
    expect(emailInput.value).toBe('edited@example.com')
  })

  it('does not show Save/Discard when not in edit mode', () => {
    render(<ResultFormView {...defaultProps} />)
    expect(screen.queryByTestId('form-edit-actions')).not.toBeInTheDocument()
  })

  it('enum select onChange fires onUpdateCell with selected value', () => {
    const onUpdateCell = vi.fn()
    const enumTableColumns: TableDataColumnMeta[] = [
      ...editTableColumns.slice(0, 2),
      {
        name: 'email',
        dataType: 'ENUM',
        isBooleanAlias: false,
        enumValues: ['alice@example.com', 'bob@example.com', 'charlie@example.com'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    render(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ editTableColumns: enumTableColumns, onUpdateCell })}
      />
    )
    fireEvent.change(screen.getByTestId('form-input-2'), {
      target: { value: 'bob@example.com' },
    })
    expect(onUpdateCell).toHaveBeenCalledWith('email', 'bob@example.com')
  })

  it('enum select onChange sends null when NULL sentinel is selected', () => {
    const onUpdateCell = vi.fn()
    const enumTableColumns: TableDataColumnMeta[] = [
      ...editTableColumns.slice(0, 2),
      {
        name: 'email',
        dataType: 'ENUM',
        isBooleanAlias: false,
        enumValues: ['alice@example.com', 'bob@example.com'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    render(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ editTableColumns: enumTableColumns, onUpdateCell })}
      />
    )
    // Simulate selecting the NULL sentinel
    fireEvent.change(screen.getByTestId('form-input-2'), {
      target: { value: '__MYSQL_CLIENT_ENUM_NULL__' },
    })
    expect(onUpdateCell).toHaveBeenCalledWith('email', null)
  })

  it('NULL toggle on enum column restores enum fallback value', () => {
    const onUpdateCell = vi.fn()
    const enumTableColumns: TableDataColumnMeta[] = [
      ...editTableColumns.slice(0, 2),
      {
        name: 'email',
        dataType: 'ENUM',
        isBooleanAlias: false,
        enumValues: ['alice@example.com', 'bob@example.com'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isAutoIncrement: false,
      },
    ]
    // editState with email = null
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Alice', email: null },
    }
    render(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({
          editTableColumns: enumTableColumns,
          onUpdateCell,
          editState,
        })}
      />
    )
    // Toggle NULL off for email (index 2)
    fireEvent.click(screen.getByTestId('null-toggle-2'))
    // Should restore with first enum value
    expect(onUpdateCell).toHaveBeenCalledWith('email', 'alice@example.com')
  })

  it('handles object values in editable input', () => {
    // Row has object value in name column
    const objRows: unknown[][] = [[1, { foo: 'bar' }, 'alice@example.com']]
    render(
      <ResultFormView
        {...defaultProps}
        rows={objRows}
        totalRows={1}
        {...buildEditProps({
          editState: {
            ...baseEditState,
            originalValues: { name: { foo: 'bar' }, email: 'alice@example.com' },
            currentValues: { name: { foo: 'bar' }, email: 'alice@example.com' },
          },
        })}
      />
    )
    const nameInput = screen.getByTestId('form-input-1') as HTMLInputElement
    expect(nameInput.value).toBe('{"foo":"bar"}')
  })

  it('handles numeric values in editable input', () => {
    // Row has number value in name column
    const numRows: unknown[][] = [[1, 42, 'alice@example.com']]
    render(
      <ResultFormView
        {...defaultProps}
        rows={numRows}
        totalRows={1}
        {...buildEditProps({
          editState: {
            ...baseEditState,
            originalValues: { name: 42, email: 'alice@example.com' },
            currentValues: { name: 42, email: 'alice@example.com' },
          },
        })}
      />
    )
    const nameInput = screen.getByTestId('form-input-1') as HTMLInputElement
    expect(nameInput.value).toBe('42')
  })

  it('copies NULL for null-value editable fields', async () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: null, email: 'alice@example.com' },
    }
    render(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    // Copy the name field (index 1) which is null in edit state
    fireEvent.click(screen.getByTestId('copy-field-1'))
    await waitFor(() => {
      expect(mockWriteClipboardText).toHaveBeenCalledWith('NULL')
    })
  })
})

// ---------------------------------------------------------------------------
// Temporal field rendering tests
// ---------------------------------------------------------------------------

const temporalColumns: ColumnMeta[] = [
  { name: 'id', dataType: 'INT' },
  { name: 'created_at', dataType: 'DATETIME' },
  { name: 'birth_date', dataType: 'DATE' },
  { name: 'login_time', dataType: 'TIME' },
]

const temporalRows: unknown[][] = [[1, '2025-01-15 10:30:00', '1990-05-20', '14:30:00']]

const temporalTableColumns: TableDataColumnMeta[] = [
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
    name: 'created_at',
    dataType: 'DATETIME',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'birth_date',
    dataType: 'DATE',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'login_time',
    dataType: 'TIME',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

const temporalEditableMap = new Map<number, boolean>([
  [0, false],
  [1, true],
  [2, true],
  [3, true],
])

const temporalEditState: RowEditState = {
  rowKey: { id: 1 },
  originalValues: {
    created_at: '2025-01-15 10:30:00',
    birth_date: '1990-05-20',
    login_time: '14:30:00',
  },
  currentValues: {
    created_at: '2025-01-15 10:30:00',
    birth_date: '1990-05-20',
    login_time: '14:30:00',
  },
  modifiedColumns: new Set<string>(),
  isNewRow: false,
}

const temporalDefaultProps = {
  columns: temporalColumns,
  rows: temporalRows,
  selectedRowIndex: 0 as number | null,
  totalRows: 1,
  currentPage: 1,
  totalPages: 1,
  onNavigate: vi.fn(),
  tabId: 'tab-1',
}

function buildTemporalEditProps(overrides: Record<string, unknown> = {}) {
  return {
    editMode: 'testdb.events' as string | null,
    editableColumnMap: temporalEditableMap,
    editState: temporalEditState as RowEditState | null,
    editingRowIndex: 0 as number | null,
    editTableColumns: temporalTableColumns,
    onStartEdit: vi.fn(),
    onUpdateCell: vi.fn(),
    onSaveRow: vi.fn().mockResolvedValue(true),
    onDiscardRow: vi.fn(),
    ...overrides,
  }
}

describe('ResultFormView — Temporal Fields', () => {
  beforeEach(() => {
    useQueryStore.setState({
      tabs: {
        'tab-1': buildTabState({
          columns: temporalColumns,
          rows: temporalRows,
          totalRows: 1,
        }),
      },
    })
  })

  it('renders calendar button for DATETIME columns', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    expect(screen.getByTestId('calendar-btn-1')).toBeInTheDocument()
    // DATETIME and DATE both get "Open date picker" — verify at least one exists
    expect(screen.getAllByLabelText('Open date picker')).toHaveLength(2)
  })

  it('renders calendar button for DATE columns', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    expect(screen.getByTestId('calendar-btn-2')).toBeInTheDocument()
  })

  it('renders clock button for TIME columns', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    expect(screen.getByTestId('calendar-btn-3')).toBeInTheDocument()
    expect(screen.getByLabelText('Open time picker')).toBeInTheDocument()
  })

  it('disables calendar button when value is NULL', () => {
    const nullEditState: RowEditState = {
      ...temporalEditState,
      currentValues: {
        created_at: null,
        birth_date: '1990-05-20',
        login_time: '14:30:00',
      },
    }
    render(
      <ResultFormView
        {...temporalDefaultProps}
        {...buildTemporalEditProps({ editState: nullEditState })}
      />
    )
    expect(screen.getByTestId('calendar-btn-1')).toBeDisabled()
  })

  it('does not render calendar button for non-temporal editable columns', () => {
    // Render with the original non-temporal columns
    render(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    // name (index 1) and email (index 2) are VARCHAR — no calendar buttons
    expect(screen.queryByTestId('calendar-btn-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-btn-2')).not.toBeInTheDocument()
  })

  it('does not render calendar button for read-only temporal columns', () => {
    // id (index 0) is not editable — no calendar button even though INT
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    expect(screen.queryByTestId('calendar-btn-0')).not.toBeInTheDocument()
  })

  it('toggles NULL off with today date for temporal columns', () => {
    const onUpdateCell = vi.fn()
    const nullEditState: RowEditState = {
      ...temporalEditState,
      currentValues: {
        created_at: null,
        birth_date: null,
        login_time: null,
      },
    }
    render(
      <ResultFormView
        {...temporalDefaultProps}
        {...buildTemporalEditProps({
          editState: nullEditState,
          onUpdateCell,
        })}
      />
    )
    // Toggle NULL off for created_at (DATETIME column, index 1)
    fireEvent.click(screen.getByTestId('null-toggle-1'))
    // Should be called with a date string (not empty string)
    expect(onUpdateCell).toHaveBeenCalledWith(
      'created_at',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    )
  })

  it('clicking calendar button opens date picker for non-null temporal field', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    // Click the calendar button for created_at (DATETIME, index 1) which is non-null
    fireEvent.click(screen.getByTestId('calendar-btn-1'))
    // The DateTimePicker should now be rendered (portal-based)
    // Verify picker controls appear (Apply / Cancel buttons from DateTimePicker)
    expect(screen.getByText('Apply')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('closing date picker via Cancel resets picker state', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    // Open picker
    fireEvent.click(screen.getByTestId('calendar-btn-1'))
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    // Click Cancel
    fireEvent.click(screen.getByText('Cancel'))
    // Picker should be dismissed
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('applying date picker value calls onUpdateCell and closes picker', () => {
    const onUpdateCell = vi.fn()
    render(
      <ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps({ onUpdateCell })} />
    )
    // Open picker for created_at (DATETIME, index 1)
    fireEvent.click(screen.getByTestId('calendar-btn-1'))
    expect(screen.getByText('Apply')).toBeInTheDocument()
    // Click Apply to close the picker with the current value
    fireEvent.click(screen.getByText('Apply'))
    // onUpdateCell should have been called with the value
    expect(onUpdateCell).toHaveBeenCalledWith('created_at', expect.any(String))
    // Picker should be dismissed
    expect(screen.queryByText('Apply')).not.toBeInTheDocument()
  })

  it('toggling NULL on closes open picker for that field', () => {
    const onUpdateCell = vi.fn()
    render(
      <ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps({ onUpdateCell })} />
    )
    // Open picker for created_at
    fireEvent.click(screen.getByTestId('calendar-btn-1'))
    expect(screen.getByText('Apply')).toBeInTheDocument()
    // Toggle NULL on for created_at
    fireEvent.click(screen.getByTestId('null-toggle-1'))
    // Picker should be dismissed (toggling NULL closes open picker)
    expect(screen.queryByText('Apply')).not.toBeInTheDocument()
    // Should have set value to null
    expect(onUpdateCell).toHaveBeenCalledWith('created_at', null)
  })

  it('clicking temporal input opens picker on first focus (first-click-open)', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    const input = screen.getByTestId('form-input-1') // created_at DATETIME
    // Click the input — this fires focus + click; since input wasn't already focused,
    // the onClick handler should open the picker
    fireEvent.click(input)
    // DateTimePicker should now be visible
    expect(screen.getByText('Apply')).toBeInTheDocument()
  })

  it('blurring temporal input resets focus tracking', () => {
    render(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    const input = screen.getByTestId('form-input-1') // created_at DATETIME
    // Focus and then blur to exercise the onBlur handler
    fireEvent.focus(input)
    fireEvent.blur(input)
    // No crash; the ref is reset — verify component is still rendered
    expect(screen.getByTestId('form-input-1')).toBeInTheDocument()
  })
})
