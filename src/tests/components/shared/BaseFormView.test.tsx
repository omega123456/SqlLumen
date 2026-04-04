import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GridColumnDescriptor, RowEditState } from '../../../types/shared-data-view'

// Mock DateTimePicker — avoids portal + react-datepicker complexity in unit tests
vi.mock('../../../components/table-data/DateTimePicker', async () => {
  const React = await import('react')
  return {
    DateTimePicker: ({
      onApply,
      onCancel,
    }: {
      onApply: (v: string) => void
      onCancel: () => void
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'date-time-picker-popup' },
        React.createElement(
          'button',
          { 'data-testid': 'mock-apply-btn', onClick: () => onApply('2023-11-24') },
          'Apply'
        ),
        React.createElement(
          'button',
          { 'data-testid': 'mock-cancel-btn', onClick: () => onCancel() },
          'Cancel'
        )
      ),
  }
})

import { BaseFormView } from '../../../components/shared/BaseFormView'
import type { BaseFormViewProps } from '../../../types/shared-data-view'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockColumns: GridColumnDescriptor[] = [
  {
    key: 'id',
    displayName: 'id',
    dataType: 'INT',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
  },
  {
    key: 'name',
    displayName: 'name',
    dataType: 'VARCHAR',
    editable: true,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'avatar',
    displayName: 'avatar',
    dataType: 'BLOB',
    editable: true,
    isBinary: true,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
]

const mockRow: unknown[] = [1, 'Alice', '[BLOB - 128 bytes]']

function defaultProps(overrides: Partial<BaseFormViewProps> = {}): BaseFormViewProps {
  return {
    columns: mockColumns,
    currentRow: mockRow,
    totalRows: 1,
    currentAbsoluteIndex: 0,
    isFirstRecord: true,
    isLastRecord: true,
    editState: null,
    testId: 'base-form-view',
    ...overrides,
  }
}

function renderForm(overrides: Partial<BaseFormViewProps> = {}) {
  return render(<BaseFormView {...defaultProps(overrides)} />)
}

// Temporal + enum columns for specialised tests
const temporalColumns: GridColumnDescriptor[] = [
  {
    key: 'id',
    displayName: 'id',
    dataType: 'INT',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
  },
  {
    key: 'created_at',
    displayName: 'created_at',
    dataType: 'DATETIME',
    editable: true,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'login_time',
    displayName: 'login_time',
    dataType: 'TIME',
    editable: true,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
]

const enumColumns: GridColumnDescriptor[] = [
  {
    key: 'id',
    displayName: 'id',
    dataType: 'INT',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
  },
  {
    key: 'status',
    displayName: 'status',
    dataType: 'ENUM',
    editable: true,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    enumValues: ['active', 'disabled'],
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
    writable: true,
    configurable: true,
  })
})

describe('BaseFormView — basic rendering', () => {
  it('renders form view with testId', () => {
    renderForm()
    expect(screen.getByTestId('base-form-view')).toBeInTheDocument()
  })

  it('shows correct "Record N of M" text', () => {
    renderForm({ currentAbsoluteIndex: 0, totalRows: 1 })
    expect(screen.getByText('Record 1 of 1')).toBeInTheDocument()
  })

  it('formats record position with toLocaleString for large numbers', () => {
    renderForm({ currentAbsoluteIndex: 999, totalRows: 10000 })
    // toLocaleString() produces locale-dependent separators; just check the text exists
    const title = screen.getByRole('heading', { level: 2 })
    expect(title.textContent).toContain('1,000')
    expect(title.textContent).toContain('10,000')
  })

  it('shows all column fields with correct test IDs', () => {
    renderForm()
    expect(screen.getByTestId('form-field-id')).toBeInTheDocument()
    expect(screen.getByTestId('form-field-name')).toBeInTheDocument()
    expect(screen.getByTestId('form-field-avatar')).toBeInTheDocument()
  })

  it('shows empty state when no rows', () => {
    renderForm({ currentRow: null, totalRows: 0 })
    expect(screen.getByText('No rows to display')).toBeInTheDocument()
  })

  it('shows empty state when totalRows is 0', () => {
    renderForm({ currentRow: null, totalRows: 0 })
    const container = screen.getByTestId('base-form-view')
    expect(container).toBeInTheDocument()
    expect(screen.queryByText(/Record/)).not.toBeInTheDocument()
  })

  it('PK field label shows "(Primary Key)"', () => {
    renderForm()
    const idField = screen.getByTestId('form-field-id')
    expect(idField).toHaveTextContent('(Primary Key)')
  })

  it('unique key field label shows "(Unique Key)"', () => {
    const cols: GridColumnDescriptor[] = [
      {
        key: 'email',
        displayName: 'email',
        dataType: 'VARCHAR',
        editable: true,
        isBinary: false,
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: true,
      },
    ]
    renderForm({ columns: cols, currentRow: ['test@example.com'] })
    const field = screen.getByTestId('form-field-email')
    expect(field).toHaveTextContent('(Unique Key)')
  })

  it('displays column names in UPPERCASE', () => {
    renderForm()
    const idField = screen.getByTestId('form-field-id')
    expect(idField.textContent).toContain('ID')
  })
})

describe('BaseFormView — navigation buttons', () => {
  it('Previous button disabled on first record', () => {
    renderForm({ isFirstRecord: true })
    expect(screen.getByTestId('btn-form-previous')).toBeDisabled()
  })

  it('Next button disabled on last record', () => {
    renderForm({ isLastRecord: true })
    expect(screen.getByTestId('btn-form-next')).toBeDisabled()
  })

  it('Both nav buttons enabled in the middle of records', () => {
    renderForm({ isFirstRecord: false, isLastRecord: false })
    expect(screen.getByTestId('btn-form-previous')).not.toBeDisabled()
    expect(screen.getByTestId('btn-form-next')).not.toBeDisabled()
  })

  it('Previous button calls onNavigatePrev', () => {
    const onNavigatePrev = vi.fn()
    renderForm({ isFirstRecord: false, onNavigatePrev })
    fireEvent.click(screen.getByTestId('btn-form-previous'))
    expect(onNavigatePrev).toHaveBeenCalledTimes(1)
  })

  it('Next button calls onNavigateNext', () => {
    const onNavigateNext = vi.fn()
    renderForm({ isLastRecord: false, onNavigateNext })
    fireEvent.click(screen.getByTestId('btn-form-next'))
    expect(onNavigateNext).toHaveBeenCalledTimes(1)
  })
})

describe('BaseFormView — read-only vs edit mode', () => {
  it('does NOT show save/discard buttons when onSave is not provided (read-only)', () => {
    renderForm({ onSave: undefined })
    expect(screen.queryByTestId('btn-form-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-form-discard')).not.toBeInTheDocument()
  })

  it('does NOT show save/discard buttons when readOnly is true even with onSave', () => {
    renderForm({ onSave: vi.fn(), readOnly: true })
    expect(screen.queryByTestId('btn-form-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-form-discard')).not.toBeInTheDocument()
  })

  it('shows save/discard buttons when onSave is provided and not readOnly', () => {
    renderForm({ onSave: vi.fn(), onDiscard: vi.fn() })
    expect(screen.getByTestId('btn-form-save')).toBeInTheDocument()
    expect(screen.getByTestId('btn-form-discard')).toBeInTheDocument()
  })

  it('save and discard buttons are ALWAYS rendered when onSave provided, even without editState', () => {
    renderForm({ onSave: vi.fn(), onDiscard: vi.fn(), editState: null })
    expect(screen.getByTestId('btn-form-save')).toBeInTheDocument()
    expect(screen.getByTestId('btn-form-discard')).toBeInTheDocument()
  })

  it('save and discard buttons are disabled when there are no modifications', () => {
    renderForm({ onSave: vi.fn(), onDiscard: vi.fn(), editState: null })
    expect(screen.getByTestId('btn-form-save')).toBeDisabled()
    expect(screen.getByTestId('btn-form-discard')).toBeDisabled()
  })

  it('save and discard buttons are disabled when editState exists but no modifications', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), onDiscard: vi.fn(), editState })
    expect(screen.getByTestId('btn-form-save')).toBeDisabled()
    expect(screen.getByTestId('btn-form-discard')).toBeDisabled()
  })

  it('save and discard buttons are enabled when modifications exist', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Changed' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), onDiscard: vi.fn(), editState })
    expect(screen.getByTestId('btn-form-save')).not.toBeDisabled()
    expect(screen.getByTestId('btn-form-discard')).not.toBeDisabled()
  })

  it('save button calls onSave when clicked', () => {
    const onSave = vi.fn()
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Changed' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave, editState })
    fireEvent.click(screen.getByTestId('btn-form-save'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('discard button calls onDiscard when clicked', () => {
    const onDiscard = vi.fn()
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Changed' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), onDiscard, editState })
    fireEvent.click(screen.getByTestId('btn-form-discard'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('non-editable fields show as read-only divs when no editCapability', () => {
    renderForm({ onSave: undefined })
    // id has editable: false, name has editable: true but no onSave → all become read-only
    const idInput = screen.getByTestId('form-input-id')
    expect(idInput.tagName).toBe('DIV')
    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.tagName).toBe('DIV')
  })

  it('editable fields show as inputs when editCapability is available', () => {
    renderForm({ onSave: vi.fn() })
    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.tagName).toBe('INPUT')
  })

  it('non-editable column (id) shows read-only div even with editCapability', () => {
    renderForm({ onSave: vi.fn() })
    const idInput = screen.getByTestId('form-input-id')
    expect(idInput.tagName).toBe('DIV')
  })
})

describe('BaseFormView — lock icons', () => {
  it('shows lock icon for non-editable columns in edit mode with editState', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    expect(screen.getByTestId('lock-icon-id')).toBeInTheDocument()
  })

  it('does NOT show lock icon when not in edit mode', () => {
    renderForm({ onSave: undefined })
    expect(screen.queryByTestId('lock-icon-id')).not.toBeInTheDocument()
  })

  it('does NOT show lock icon for editable columns', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    expect(screen.queryByTestId('lock-icon-name')).not.toBeInTheDocument()
  })

  it('does NOT show lock icon when editState is null even with onSave', () => {
    renderForm({ onSave: vi.fn(), editState: null })
    expect(screen.queryByTestId('lock-icon-id')).not.toBeInTheDocument()
  })
})

describe('BaseFormView — BLOB field', () => {
  it('BLOB field renders as read-only div', () => {
    renderForm({ onSave: vi.fn() })
    const avatarInput = screen.getByTestId('form-input-avatar')
    expect(avatarInput.tagName).toBe('DIV')
  })

  it('BLOB field shows data when value is not null', () => {
    renderForm()
    const avatarField = screen.getByTestId('form-input-avatar')
    expect(avatarField).toHaveTextContent('[BLOB - 128 bytes]')
  })

  it('BLOB field shows "(BLOB data)" when value is null', () => {
    renderForm({ currentRow: [1, 'Alice', null] })
    const avatarField = screen.getByTestId('form-input-avatar')
    expect(avatarField).toHaveTextContent('(BLOB data)')
  })

  it('NULL toggle not shown for BLOB fields even if nullable', () => {
    renderForm({ onSave: vi.fn() })
    expect(screen.queryByTestId('btn-null-avatar')).not.toBeInTheDocument()
  })
})

describe('BaseFormView — NULL toggle', () => {
  it('NULL toggle button shown for nullable editable fields', () => {
    renderForm({ onSave: vi.fn() })
    expect(screen.getByTestId('btn-null-name')).toBeInTheDocument()
  })

  it('NULL toggle button NOT shown for non-nullable fields', () => {
    renderForm({ onSave: vi.fn() })
    expect(screen.queryByTestId('btn-null-id')).not.toBeInTheDocument()
  })

  it('NULL toggle button NOT shown in read-only mode', () => {
    renderForm({ onSave: undefined })
    expect(screen.queryByTestId('btn-null-name')).not.toBeInTheDocument()
  })

  it('NULL toggle text shows "Set NULL" when value is not null', () => {
    renderForm({ onSave: vi.fn() })
    const btn = screen.getByTestId('btn-null-name')
    expect(btn).toHaveTextContent('Set NULL')
  })

  it('NULL toggle text shows "Set Value" when value is null', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: null },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({
      onSave: vi.fn(),
      editState,
      currentRow: [1, 'Alice', null],
    })
    const btn = screen.getByTestId('btn-null-name')
    expect(btn).toHaveTextContent('Set Value')
  })

  it('clicking NULL toggle calls onUpdateCell with null when value is not null', () => {
    const onUpdateCell = vi.fn()
    renderForm({ onSave: vi.fn(), onUpdateCell })
    fireEvent.click(screen.getByTestId('btn-null-name'))
    expect(onUpdateCell).toHaveBeenCalledWith('name', null)
  })

  it('clicking NULL toggle on null text field calls onUpdateCell with empty string', () => {
    const onUpdateCell = vi.fn()
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: null },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({
      onSave: vi.fn(),
      onUpdateCell,
      editState,
      currentRow: [1, 'Alice', null],
    })
    fireEvent.click(screen.getByTestId('btn-null-name'))
    expect(onUpdateCell).toHaveBeenCalledWith('name', '')
  })

  it('clicking NULL toggle on null temporal field sets today date string', () => {
    const onUpdateCell = vi.fn()
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, created_at: null, login_time: '14:30:00' },
      originalValues: { id: 1, created_at: '2023-06-15 10:30:00', login_time: '14:30:00' },
    }
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
      onUpdateCell,
      editState,
    })
    fireEvent.click(screen.getByTestId('btn-null-created_at'))
    expect(onUpdateCell).toHaveBeenCalledTimes(1)
    const [key, value] = onUpdateCell.mock.calls[0]
    expect(key).toBe('created_at')
    // Should be a DATETIME string, not empty string
    expect(value).not.toBe('')
    expect(value).not.toBeNull()
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('clicking NULL toggle on null enum field sets first enum value', () => {
    const onUpdateCell = vi.fn()
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, status: null },
      originalValues: { id: 1, status: 'active' },
    }
    renderForm({
      columns: enumColumns,
      currentRow: [1, 'active'],
      onSave: vi.fn(),
      onUpdateCell,
      editState,
    })
    fireEvent.click(screen.getByTestId('btn-null-status'))
    expect(onUpdateCell).toHaveBeenCalledWith('status', 'active')
  })
})

describe('BaseFormView — modified field indicators', () => {
  it('modified field shows modified dot', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Changed' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    expect(screen.getByTestId('modified-dot-name')).toBeInTheDocument()
  })

  it('modified field shows "Unsaved change detected" note', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Changed' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    expect(screen.getByTestId('modified-note-name')).toBeInTheDocument()
    expect(screen.getByText('Unsaved change detected')).toBeInTheDocument()
  })

  it('unmodified field does NOT show modified dot', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Alice' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    expect(screen.queryByTestId('modified-dot-name')).not.toBeInTheDocument()
  })

  it('modified input has modified CSS class', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Changed' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput.className).toContain('Modified')
  })
})

describe('BaseFormView — input interactions', () => {
  it('typing in input calls onUpdateCell', () => {
    const onUpdateCell = vi.fn()
    renderForm({ onSave: vi.fn(), onUpdateCell })
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    fireEvent.focus(nameInput)
    fireEvent.change(nameInput, { target: { value: 'NewName' } })
    expect(onUpdateCell).toHaveBeenCalledWith('name', 'NewName')
  })

  it('focusing input calls onEnsureEditing', () => {
    const onEnsureEditing = vi.fn()
    renderForm({ onSave: vi.fn(), onEnsureEditing })
    const nameInput = screen.getByTestId('form-input-name')
    fireEvent.focus(nameInput)
    expect(onEnsureEditing).toHaveBeenCalled()
  })

  it('displays edited value from editState instead of raw row data', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: 'Edited' },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('Edited')
  })

  it('null value in editState renders empty input', () => {
    const editState: RowEditState = {
      rowKey: '1',
      currentValues: { id: 1, name: null },
      originalValues: { id: 1, name: 'Alice' },
    }
    renderForm({ onSave: vi.fn(), editState })
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('')
  })

  it('read-only field displays "NULL" when value is null', () => {
    renderForm({
      onSave: undefined,
      currentRow: [1, null, null],
    })
    const nameInput = screen.getByTestId('form-input-name')
    expect(nameInput).toHaveTextContent('NULL')
  })
})

describe('BaseFormView — copy button', () => {
  it('copy button calls navigator.clipboard.writeText with the value', () => {
    renderForm()
    const copyBtn = screen.getByTestId('btn-copy-name')
    fireEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Alice')
  })

  it('copy button copies NULL as "NULL" string for null values', () => {
    renderForm({ currentRow: [1, null, null] })
    const copyBtn = screen.getByTestId('btn-copy-name')
    fireEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('NULL')
  })

  it('copy button logs error on clipboard failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Clipboard denied')),
      },
      writable: true,
      configurable: true,
    })
    renderForm()
    fireEvent.click(screen.getByTestId('btn-copy-name'))

    // Wait for the async clipboard call to reject
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[base-form-view] clipboard write failed:',
        expect.any(Error)
      )
    })
    consoleError.mockRestore()
  })

  it('each column has a copy button', () => {
    renderForm()
    expect(screen.getByTestId('btn-copy-id')).toBeInTheDocument()
    expect(screen.getByTestId('btn-copy-name')).toBeInTheDocument()
    expect(screen.getByTestId('btn-copy-avatar')).toBeInTheDocument()
  })
})

describe('BaseFormView — enum fields', () => {
  it('enum field renders as combobox', () => {
    renderForm({
      columns: enumColumns,
      currentRow: [1, 'active'],
      onSave: vi.fn(),
    })
    const statusInput = screen.getByTestId('form-input-status')
    expect(statusInput).toHaveAttribute('role', 'combobox')
  })

  it('enum select includes all enum values as options', async () => {
    const user = userEvent.setup()
    renderForm({
      columns: enumColumns,
      currentRow: [1, 'active'],
      onSave: vi.fn(),
    })
    await user.click(screen.getByTestId('form-input-status'))
    const names = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(names).toContain('active')
    expect(names).toContain('disabled')
  })

  it('nullable enum includes NULL sentinel option', async () => {
    const user = userEvent.setup()
    renderForm({
      columns: enumColumns,
      currentRow: [1, 'active'],
      onSave: vi.fn(),
    })
    await user.click(screen.getByTestId('form-input-status'))
    const names = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(names).toContain('NULL')
  })

  it('selecting NULL sentinel in enum calls onUpdateCell with null', async () => {
    const user = userEvent.setup()
    const onUpdateCell = vi.fn()
    renderForm({
      columns: enumColumns,
      currentRow: [1, 'active'],
      onSave: vi.fn(),
      onUpdateCell,
    })
    await user.click(screen.getByTestId('form-input-status'))
    await user.click(screen.getByRole('option', { name: 'NULL' }))
    expect(onUpdateCell).toHaveBeenCalledWith('status', null)
  })

  it('selecting a regular enum value calls onUpdateCell', async () => {
    const user = userEvent.setup()
    const onUpdateCell = vi.fn()
    renderForm({
      columns: enumColumns,
      currentRow: [1, 'active'],
      onSave: vi.fn(),
      onUpdateCell,
    })
    await user.click(screen.getByTestId('form-input-status'))
    await user.click(screen.getByRole('option', { name: 'disabled' }))
    expect(onUpdateCell).toHaveBeenCalledWith('status', 'disabled')
  })
})

describe('BaseFormView — DateTimePicker integration', () => {
  it('temporal columns render a calendar/clock icon button', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    expect(screen.getByTestId('calendar-btn-created_at')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-btn-login_time')).toBeInTheDocument()
  })

  it('non-temporal columns do NOT render a calendar icon', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    expect(screen.queryByTestId('calendar-btn-id')).not.toBeInTheDocument()
  })

  it('DATE/DATETIME columns have aria-label "Open date picker"', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    expect(screen.getByTestId('calendar-btn-created_at')).toHaveAttribute(
      'aria-label',
      'Open date picker'
    )
  })

  it('TIME columns have aria-label "Open time picker"', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    expect(screen.getByTestId('calendar-btn-login_time')).toHaveAttribute(
      'aria-label',
      'Open time picker'
    )
  })

  it('clicking the calendar icon opens the DateTimePicker', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
  })

  it('picker onApply calls onUpdateCell with the applied value', () => {
    const onUpdateCell = vi.fn()
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
      onUpdateCell,
    })
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    fireEvent.click(screen.getByTestId('mock-apply-btn'))
    expect(onUpdateCell).toHaveBeenCalledWith('created_at', '2023-11-24')
  })

  it('picker onCancel closes the popup without calling onUpdateCell', () => {
    const onUpdateCell = vi.fn()
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
      onUpdateCell,
    })
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-cancel-btn'))
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
    expect(onUpdateCell).not.toHaveBeenCalled()
  })

  it('only one picker is open at a time', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getAllByTestId('date-time-picker-popup')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('calendar-btn-login_time'))
    expect(screen.getAllByTestId('date-time-picker-popup')).toHaveLength(1)
  })

  it('calendar button is disabled when temporal field value is NULL', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, null, null],
      onSave: vi.fn(),
    })
    expect(screen.getByTestId('calendar-btn-created_at')).toBeDisabled()
    expect(screen.getByTestId('calendar-btn-login_time')).toBeDisabled()
  })

  it('calendar button is enabled when temporal field value is non-null', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
    })
    expect(screen.getByTestId('calendar-btn-created_at')).not.toBeDisabled()
    expect(screen.getByTestId('calendar-btn-login_time')).not.toBeDisabled()
  })

  it('NULL toggle closes picker if it was open for that field', () => {
    const onUpdateCell = vi.fn()
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
      onUpdateCell,
    })
    // Open picker
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByTestId('date-time-picker-popup')).toBeInTheDocument()
    // Click NULL toggle
    fireEvent.click(screen.getByTestId('btn-null-created_at'))
    // Picker should be closed
    expect(screen.queryByTestId('date-time-picker-popup')).not.toBeInTheDocument()
  })

  it('read-only temporal columns do not show calendar button', () => {
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: undefined,
    })
    expect(screen.queryByTestId('calendar-btn-created_at')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-btn-login_time')).not.toBeInTheDocument()
  })

  it('direct typing in text input still works for temporal fields', () => {
    const onUpdateCell = vi.fn()
    renderForm({
      columns: temporalColumns,
      currentRow: [1, '2023-06-15 10:30:00', '14:30:00'],
      onSave: vi.fn(),
      onUpdateCell,
    })
    const input = screen.getByTestId('form-input-created_at') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '2023-12-25 00:00:00' } })
    expect(onUpdateCell).toHaveBeenCalledWith('created_at', '2023-12-25 00:00:00')
  })
})

describe('BaseFormView — custom testId', () => {
  it('uses custom testId when provided', () => {
    renderForm({ testId: 'my-custom-form' })
    expect(screen.getByTestId('my-custom-form')).toBeInTheDocument()
  })

  it('defaults to "base-form-view" testId', () => {
    render(
      <BaseFormView
        columns={mockColumns}
        currentRow={mockRow}
        totalRows={1}
        currentAbsoluteIndex={0}
        isFirstRecord={true}
        isLastRecord={true}
        editState={null}
      />
    )
    expect(screen.getByTestId('base-form-view')).toBeInTheDocument()
  })
})

describe('BaseFormView — optional insert/delete capabilities', () => {
  it('accepts optional insert/delete capability props without affecting rendering', () => {
    const onInsertRow = vi.fn()
    const onDeleteRow = vi.fn()
    renderForm({
      onInsertRow,
      onDeleteRow,
      canInsert: true,
      canDelete: true,
    })
    // The form renders fine with these props — they're part of the shared contract
    expect(screen.getByTestId('base-form-view')).toBeInTheDocument()
    // The form itself doesn't call these — they're for toolbar/parent consumption
    expect(onInsertRow).not.toHaveBeenCalled()
    expect(onDeleteRow).not.toHaveBeenCalled()
  })
})
