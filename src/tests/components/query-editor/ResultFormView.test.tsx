import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ResultFormView as WindowedResultFormView,
  type ResultFormViewProps,
} from '../../../components/query-editor/ResultFormView'
import { applySavedRowValues, seedResultWindow } from '../../../lib/result-window-cache'
import { useQueryStore } from '../../../stores/query-store'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../../types/schema'
import { makeTabState } from '../../helpers/query-test-utils'
import { ipc } from '../../ipc-mock'

/**
 * Test adapter: the form view reads windowed rows from the page cache. These
 * tests describe a result by its `rows`, so the adapter seeds the real page
 * cache (identity view, base indices 0..n-1) and renders the windowed props.
 * Seeding happens in `renderForm`, outside React's render phase.
 */
type LegacyFormProps = Omit<
  ResultFormViewProps,
  'resultIndex' | 'queryId' | 'viewVersion' | 'viewRowCount'
> & { rows: unknown[][]; totalRows?: number }

function ResultFormView({ rows, totalRows, ...props }: LegacyFormProps) {
  void rows
  return (
    <WindowedResultFormView
      {...props}
      resultIndex={0}
      queryId="q-form"
      viewVersion={1}
      viewRowCount={totalRows ?? rows.length}
    />
  )
}

function seedFormRows(element: React.ReactElement<LegacyFormProps>) {
  const { rows, columns, tabId } = element.props
  seedResultWindow({
    connectionId: 'conn-1',
    tabId,
    resultIndex: 0,
    queryId: 'q-form',
    viewVersion: 1,
    viewRowCount: element.props.totalRows ?? rows.length,
    columns,
    window: { offset: 0, rows, baseIndices: rows.map((_, index) => index) },
  })
}

function renderForm(element: React.ReactElement<LegacyFormProps>) {
  seedFormRows(element)
  return render(element)
}

// Mock navigator.clipboard for BaseFormView's copy handler
const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockClipboardWriteText },
  writable: true,
  configurable: true,
})

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
  onNavigate: vi.fn(),
  tabId: 'tab-1',
}

/** Helper to build a complete tab state for the query store. */
function buildTabState(overrides: Record<string, unknown> = {}) {
  return makeTabState({
    status: 'success' as const,
    columns,
    rows,
    totalRows: 5,
    executionTimeMs: 10,
    affectedRows: 0,
    queryId: 'q1',
    viewMode: 'form' as const,
    selectedRowIndex: 0,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockClipboardWriteText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockClipboardWriteText },
    writable: true,
    configurable: true,
  })
  // Set up query store with tab state (so pageSize is accessible)
  useQueryStore.setState({
    tabs: {
      'tab-1': buildTabState(),
    },
  })
})

describe('ResultFormView', () => {
  it('shows the record label and values of the selected row, with NULL as text and the first row as fallback', () => {
    const selectedRow = renderForm(<ResultFormView {...defaultProps} selectedRowIndex={2} />)
    expect(screen.getByTestId('result-form-view')).toBeInTheDocument()
    expect(screen.getByTestId('form-record-label')).toHaveTextContent(/^Record 3 of 5$/)
    expect(screen.getByTestId('form-input-id')).toHaveTextContent('3')
    expect(screen.getByTestId('form-input-name')).toHaveTextContent('Charlie')
    expect(screen.getByTestId('form-input-email')).toHaveTextContent('charlie@example.com')
    selectedRow.unmount()

    const nullEmailRow = renderForm(<ResultFormView {...defaultProps} selectedRowIndex={1} />)
    expect(screen.getByTestId('form-input-email')).toHaveTextContent('NULL')
    nullEmailRow.unmount()

    renderForm(<ResultFormView {...defaultProps} selectedRowIndex={null} />)
    expect(screen.getByTestId('form-record-label')).toHaveTextContent(/^Record 1 of 5$/)
    expect(screen.getByTestId('form-input-id')).toHaveTextContent('1')
    expect(screen.getByTestId('form-input-name')).toHaveTextContent('Alice')
  })

  it('navigates through onNavigate with labelled buttons and disables Next on the last record', () => {
    const onNavigate = vi.fn()
    const middleRecord = renderForm(
      <ResultFormView {...defaultProps} selectedRowIndex={2} onNavigate={onNavigate} />
    )
    expect(screen.getByLabelText('Previous record')).not.toBeDisabled()
    expect(screen.getByLabelText('Next record')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('btn-form-previous'))
    fireEvent.click(screen.getByTestId('btn-form-next'))

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'prev')
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'next')
    middleRecord.unmount()

    renderForm(<ResultFormView {...defaultProps} selectedRowIndex={4} />)
    expect(screen.getByTestId('btn-form-next')).toBeDisabled()
  })

  it('renders with empty rows showing empty state', () => {
    renderForm(<ResultFormView {...defaultProps} rows={[]} totalRows={0} />)
    expect(screen.getByTestId('result-form-view')).toBeInTheDocument()
    expect(screen.getByText('No rows to display')).toBeInTheDocument()
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
    editColumnBindings: new Map<number, string>([
      [0, 'id'],
      [1, 'name'],
      [2, 'email'],
    ]),
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
  it('renders lock icon on non-editable columns', () => {
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    expect(screen.getByTestId('lock-icon-id')).toBeInTheDocument()
    // Editable columns should not have lock icons
    expect(screen.queryByTestId('lock-icon-name')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lock-icon-email')).not.toBeInTheDocument()
  })

  it('uses the blob viewer as the edit affordance for bound binary columns', async () => {
    const user = userEvent.setup()
    const blobColumns: ColumnMeta[] = [
      { name: 'id', dataType: 'INT' },
      { name: 'photo', dataType: 'BLOB' },
    ]
    const blobRows: unknown[][] = [[1, 'SGVsbG8=']]
    const blobEditColumns: TableDataColumnMeta[] = [
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
        name: 'photo',
        dataType: 'BLOB',
        isBooleanAlias: false,
        enumValues: undefined,
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: true,
        isAutoIncrement: false,
      },
    ]

    renderForm(
      <ResultFormView
        {...defaultProps}
        columns={blobColumns}
        rows={blobRows}
        totalRows={1}
        {...buildEditProps({
          editableColumnMap: new Map([
            [0, false],
            [1, false],
          ]),
          editColumnBindings: new Map([
            [0, 'id'],
            [1, 'photo'],
          ]),
          editTableColumns: blobEditColumns,
        })}
      />
    )

    expect(screen.queryByTestId('lock-icon-photo')).not.toBeInTheDocument()
    expect(screen.getByTestId('btn-blob-view-photo')).toBeInTheDocument()

    await user.click(screen.getByTestId('btn-blob-view-photo'))
    expect(await screen.findByTestId('blob-viewer-dialog')).toBeInTheDocument()
  })

  it('keeps the blob viewer reachable for read-only query-result blobs based on result column data type', async () => {
    const user = userEvent.setup()
    const blobColumns: ColumnMeta[] = [
      { name: 'id', dataType: 'INT' },
      { name: 'photo', dataType: 'BLOB' },
    ]
    const blobRows: unknown[][] = [[1, 'SGVsbG8=']]

    renderForm(
      <ResultFormView
        {...defaultProps}
        columns={blobColumns}
        rows={blobRows}
        totalRows={1}
        selectedRowIndex={0}
        editMode={null}
      />
    )

    expect(screen.getByTestId('btn-blob-view-photo')).toBeInTheDocument()

    await user.click(screen.getByTestId('btn-blob-view-photo'))
    expect(await screen.findByTestId('blob-viewer-dialog')).toBeInTheDocument()
  })

  it('renders non-editable columns as read-only divs and editable as inputs', () => {
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    // id (non-editable) should be a read-only div
    const idField = screen.getByTestId('form-input-id')
    expect(idField.tagName).toBe('DIV')
    // name (editable) should be an input
    const nameField = screen.getByTestId('form-input-name')
    expect(nameField.tagName).toBe('INPUT')
  })

  it('populates editable inputs with current values', () => {
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps()} />)
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('Alice')
    const emailInput = screen.getByTestId('form-input-email') as HTMLInputElement
    expect(emailInput.value).toBe('alice@example.com')
  })

  it('calls onUpdateCell when input value changes', () => {
    const onUpdateCell = vi.fn()
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ onUpdateCell })} />)
    fireEvent.change(screen.getByTestId('form-input-name'), { target: { value: 'Bob' } })
    expect(onUpdateCell).toHaveBeenCalledWith(1, 'Bob')
  })

  it('renders FK lookup trigger for editable FK fields when row data is available', () => {
    renderForm(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({
          editForeignKeys: [
            {
              columnName: 'email',
              referencedDatabase: 'testdb',
              referencedTable: 'users',
              referencedColumn: 'id',
              constraintName: 'fk_users_email',
            },
          ],
        })}
      />
    )

    expect(screen.getByTestId('fk-lookup-trigger')).toBeInTheDocument()
  })

  it('uses bound source values for aliased editable fields', () => {
    const aliasColumns: ColumnMeta[] = [
      { name: 'user_id', dataType: 'INT' },
      { name: 'name', dataType: 'VARCHAR' },
      { name: 'email', dataType: 'VARCHAR' },
    ]
    const aliasRows = [[1, 'Alice', 'alice@example.com']]
    const aliasEditState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice', email: 'alice@example.com' },
      currentValues: { id: 5, name: 'Alice', email: 'alice@example.com' },
      modifiedColumns: new Set(['id']),
      isNewRow: false,
    }

    renderForm(
      <ResultFormView
        {...defaultProps}
        columns={aliasColumns}
        rows={aliasRows}
        {...buildEditProps({
          editableColumnMap: new Map([
            [0, true],
            [1, true],
            [2, true],
          ]),
          editColumnBindings: new Map([
            [0, 'id'],
            [1, 'name'],
            [2, 'email'],
          ]),
          editState: aliasEditState,
        })}
      />
    )

    const userIdInput = screen.getByTestId('form-input-user_id') as HTMLInputElement
    expect(userIdInput.value).toBe('5')
  })

  it('does not render unbound duplicate columns as editable during aliased join editing', () => {
    const joinedColumns: ColumnMeta[] = [
      { name: 'id', dataType: 'INT' },
      { name: 'user_id', dataType: 'INT' },
      { name: 'name', dataType: 'VARCHAR' },
    ]
    const joinedRows = [[100, 1, 'Alice']]
    const joinedEditState: RowEditState = {
      rowKey: { id: 1 },
      originalValues: { id: 1, name: 'Alice' },
      currentValues: { id: 5, name: 'Alice' },
      modifiedColumns: new Set(['id']),
      isNewRow: false,
    }

    renderForm(
      <ResultFormView
        {...defaultProps}
        columns={joinedColumns}
        rows={joinedRows}
        totalRows={1}
        {...buildEditProps({
          editableColumnMap: new Map([
            [0, false],
            [1, true],
            [2, true],
          ]),
          editColumnBindings: new Map([
            [1, 'id'],
            [2, 'name'],
          ]),
          editState: joinedEditState,
        })}
      />
    )

    expect(screen.getByTestId('form-input-id').tagName).toBe('DIV')
    expect((screen.getByTestId('form-input-user_id') as HTMLInputElement).value).toBe('5')
  })

  it('calls onStartEdit when editable input receives focus', () => {
    const onStartEdit = vi.fn()
    renderForm(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ onStartEdit, editState: null, editingRowIndex: null })}
      />
    )
    fireEvent.focus(screen.getByTestId('form-input-name'))
    // The view position plus the cached row (with its base index) it edits.
    expect(onStartEdit).toHaveBeenCalledWith(0, { row: rows[0], baseIndex: 0 })
  })

  it('fetches a row outside the loaded pages when navigating to it', async () => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      queryId: 'q-form',
      viewVersion: 1,
      viewRowCount: 4000,
      columns,
      window: { offset: 0, rows, baseIndices: rows.map((_, index) => index) },
    })
    ipc.overridePayload('fetch_result_window', (args) => ({
      offset: args?.offset,
      rows: [[3500, 'Far', 'far@example.com']],
      baseIndices: [3499],
      viewRowCount: 4000,
      viewVersion: 1,
    }))
    render(
      <WindowedResultFormView
        {...defaultProps}
        resultIndex={0}
        queryId="q-form"
        viewVersion={1}
        viewRowCount={4000}
        selectedRowIndex={3499}
      />
    )
    expect(await screen.findByTestId('form-record-label')).toHaveTextContent(
      /^Record 3,?500 of 4,?000$/
    )
    await waitFor(() => expect(screen.getByTestId('form-input-name')).toHaveTextContent('Far'))
    expect(ipc.payloads('fetch_result_window')[0]).toMatchObject({ offset: 3499, limit: 1 })
  })

  it('shows a saved edit of a fetched row outside the loaded pages', async () => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      queryId: 'q-form',
      viewVersion: 1,
      viewRowCount: 4000,
      columns,
      window: { offset: 0, rows, baseIndices: rows.map((_, index) => index) },
    })
    ipc.overridePayload('fetch_result_window', (args) => ({
      offset: args?.offset,
      rows: [[3500, 'Far', 'far@example.com']],
      baseIndices: [3499],
      viewRowCount: 4000,
      viewVersion: 1,
    }))
    render(
      <WindowedResultFormView
        {...defaultProps}
        resultIndex={0}
        queryId="q-form"
        viewVersion={1}
        viewRowCount={4000}
        selectedRowIndex={3499}
      />
    )
    await waitFor(() => expect(screen.getByTestId('form-input-name')).toHaveTextContent('Far'))

    // The store saved the row: base index 3499, column 1 changed.
    act(() => {
      applySavedRowValues({
        tabId: 'tab-1',
        resultIndex: 0,
        queryId: 'q-form',
        baseIndex: 3499,
        updates: { 1: 'Farther' },
      })
    })
    await waitFor(() => expect(screen.getByTestId('form-input-name')).toHaveTextContent('Farther'))
    // A save of another row leaves the shown row alone.
    act(() => {
      applySavedRowValues({
        tabId: 'tab-1',
        resultIndex: 0,
        queryId: 'q-form',
        baseIndex: 12,
        updates: { 1: 'Other' },
      })
    })
    expect(screen.getByTestId('form-input-name')).toHaveTextContent('Farther')
    expect(ipc.payloads('fetch_result_window')).toHaveLength(1)
  })

  it('routes results_expired while fetching the row to the expired block', async () => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      queryId: 'q-form',
      viewVersion: 1,
      viewRowCount: 4000,
      columns,
      window: { offset: 0, rows: [], baseIndices: [] },
    })
    ipc.override('fetch_result_window', () => {
      throw new Error('results_expired: gone')
    })
    render(
      <WindowedResultFormView
        {...defaultProps}
        resultIndex={0}
        queryId="q-form"
        viewVersion={1}
        viewRowCount={4000}
        selectedRowIndex={3000}
      />
    )
    await waitFor(() =>
      expect(useQueryStore.getState().tabs['tab-1']!.results[0].isExpired).toBe(true)
    )
  })

  it('logs and keeps the form empty when the row cannot be fetched', async () => {
    seedResultWindow({
      connectionId: 'conn-1',
      tabId: 'tab-1',
      resultIndex: 0,
      queryId: 'q-form',
      viewVersion: 1,
      viewRowCount: 4000,
      columns,
      window: { offset: 0, rows: [], baseIndices: [] },
    })
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    render(
      <WindowedResultFormView
        {...defaultProps}
        resultIndex={0}
        queryId="q-form"
        viewVersion={1}
        viewRowCount={4000}
        selectedRowIndex={3000}
      />
    )
    await waitFor(() => expect(ipc.payloads('log_frontend').length).toBeGreaterThan(0))
  })

  it('shows the clone draft as a virtual row after the last view row', () => {
    renderForm(
      <ResultFormView
        {...defaultProps}
        draftRow={[null, 'Clone', 'clone@example.com']}
        selectedRowIndex={5}
      />
    )
    expect(screen.getByTestId('form-record-label')).toHaveTextContent(/^Record 6 of 6$/)
    expect(screen.getByTestId('form-input-name')).toHaveTextContent('Clone')
  })

  it('NULL toggle calls onUpdateCell with null when value is non-null', () => {
    const onUpdateCell = vi.fn()
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ onUpdateCell })} />)
    fireEvent.click(screen.getByTestId('btn-null-name'))
    expect(onUpdateCell).toHaveBeenCalledWith(1, null)
  })

  it('NULL toggle calls onUpdateCell with empty string when value is null', () => {
    const onUpdateCell = vi.fn()
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: null, email: 'alice@example.com' },
    }
    renderForm(
      <ResultFormView {...defaultProps} {...buildEditProps({ editState, onUpdateCell })} />
    )
    fireEvent.click(screen.getByTestId('btn-null-name'))
    // Toggling NULL off should set to empty string
    expect(onUpdateCell).toHaveBeenCalledWith(1, '')
  })

  it('shows modified indicator when a column is modified', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    expect(screen.getByTestId('modified-dot-name')).toBeInTheDocument()
    expect(screen.getByTestId('modified-note-name')).toBeInTheDocument()
    expect(screen.getByTestId('modified-note-name')).toHaveTextContent('Unsaved change detected')
    // Unmodified column should not have indicator
    expect(screen.queryByTestId('modified-dot-email')).not.toBeInTheDocument()
  })

  it('shows Save/Discard buttons when in edit mode', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    expect(screen.getByTestId('btn-form-save')).toBeInTheDocument()
    expect(screen.getByTestId('btn-form-discard')).toBeInTheDocument()
  })

  it('calls onSaveRow when Save button is clicked', async () => {
    const onSaveRow = vi.fn().mockResolvedValue(true)
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ editState, onSaveRow })} />)
    fireEvent.click(screen.getByTestId('btn-form-save'))
    await waitFor(() => {
      expect(onSaveRow).toHaveBeenCalled()
    })
  })

  it('calls onDiscardRow when Discard button is clicked', () => {
    const onDiscardRow = vi.fn()
    // Need modifications so Discard button is enabled
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'Modified', email: 'alice@example.com' },
      modifiedColumns: new Set(['name']),
    }
    renderForm(
      <ResultFormView {...defaultProps} {...buildEditProps({ onDiscardRow, editState })} />
    )
    fireEvent.click(screen.getByTestId('btn-form-discard'))
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
    renderForm(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        {...buildEditProps({ onSaveRow, editState })}
      />
    )
    fireEvent.click(screen.getByTestId('btn-form-next'))
    // Should auto-save first
    await waitFor(() => expect(onSaveRow).toHaveBeenCalled())
    // Then navigate
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('discards unmodified edit state and navigates directly in edit mode', () => {
    const onDiscardRow = vi.fn()
    const onNavigate = vi.fn()
    renderForm(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        {...buildEditProps({ onDiscardRow })}
      />
    )
    // editState exists but no modifications — should discard and navigate
    fireEvent.click(screen.getByTestId('btn-form-next'))
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
    renderForm(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        {...buildEditProps({ onSaveRow, editState })}
      />
    )
    fireEvent.click(screen.getByTestId('btn-form-next'))
    await waitFor(() => expect(onSaveRow).toHaveBeenCalled())
    // Navigation should NOT happen because save failed
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('navigates directly without guard when not in edit mode', () => {
    const onNavigate = vi.fn()
    renderForm(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={2}
        onNavigate={onNavigate}
        editMode={null}
      />
    )
    fireEvent.click(screen.getByTestId('btn-form-next'))
    expect(onNavigate).toHaveBeenCalledWith('next')
  })

  it('uses edit state values when actively editing the current row', () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: 'EditedName', email: 'edited@example.com' },
      modifiedColumns: new Set(['name', 'email']),
    }
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('EditedName')
    const emailInput = screen.getByTestId('form-input-email') as HTMLInputElement
    expect(emailInput.value).toBe('edited@example.com')
  })

  it('keeps the fallback row uncommitted to store selection while selectedRowIndex is null', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': buildTabState({
          selectedRowIndex: null,
        }),
      },
    })

    renderForm(
      <ResultFormView
        {...defaultProps}
        selectedRowIndex={null}
        {...buildEditProps({ editState: null, editingRowIndex: null })}
      />
    )

    fireEvent.focus(screen.getByTestId('form-input-name'))

    const result = useQueryStore.getState().tabs['tab-1']?.results[0]
    expect(result?.selectedRowIndex).toBeNull()
    expect(screen.getByTestId('form-record-label')).toHaveTextContent(/^Record 1 of 5$/)
  })

  it('enum select onChange fires onUpdateCell with selected value', async () => {
    const user = userEvent.setup()
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
    renderForm(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ editTableColumns: enumTableColumns, onUpdateCell })}
      />
    )
    await user.click(screen.getByTestId('form-input-email'))
    await user.click(screen.getByRole('option', { name: 'bob@example.com' }))
    expect(onUpdateCell).toHaveBeenCalledWith(2, 'bob@example.com')
  })

  it('enum select onChange sends null when NULL sentinel is selected', async () => {
    const user = userEvent.setup()
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
    renderForm(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({ editTableColumns: enumTableColumns, onUpdateCell })}
      />
    )
    await user.click(screen.getByTestId('form-input-email'))
    await user.click(screen.getByRole('option', { name: 'NULL' }))
    expect(onUpdateCell).toHaveBeenCalledWith(2, null)
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
    renderForm(
      <ResultFormView
        {...defaultProps}
        {...buildEditProps({
          editTableColumns: enumTableColumns,
          onUpdateCell,
          editState,
        })}
      />
    )
    // Toggle NULL off for email
    fireEvent.click(screen.getByTestId('btn-null-email'))
    // Should restore with first enum value
    expect(onUpdateCell).toHaveBeenCalledWith(2, 'alice@example.com')
  })

  it('handles object values in editable input', () => {
    // Row has object value in name column
    const objRows: unknown[][] = [[1, { foo: 'bar' }, 'alice@example.com']]
    renderForm(
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
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('{"foo":"bar"}')
  })

  it('handles numeric values in editable input', () => {
    // Row has number value in name column
    const numRows: unknown[][] = [[1, 42, 'alice@example.com']]
    renderForm(
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
    const nameInput = screen.getByTestId('form-input-name') as HTMLInputElement
    expect(nameInput.value).toBe('42')
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
  onNavigate: vi.fn(),
  tabId: 'tab-1',
}

function buildTemporalEditProps(overrides: Record<string, unknown> = {}) {
  return {
    editMode: 'testdb.events' as string | null,
    editableColumnMap: temporalEditableMap,
    editColumnBindings: new Map<number, string>([
      [0, 'id'],
      [1, 'created_at'],
      [2, 'birth_date'],
      [3, 'login_time'],
    ]),
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

  it('copies NULL for null-value editable fields', async () => {
    const editState: RowEditState = {
      ...baseEditState,
      currentValues: { name: null, email: 'alice@example.com' },
    }
    renderForm(<ResultFormView {...defaultProps} {...buildEditProps({ editState })} />)
    // Copy the name field which is null in edit state
    fireEvent.click(screen.getByTestId('btn-copy-name'))
    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith('NULL')
    })
  })

  it('renders calendar button for DATETIME columns', () => {
    renderForm(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    expect(screen.getByTestId('calendar-btn-created_at')).toBeInTheDocument()
    // DATETIME and DATE both get "Open date picker" — verify at least one exists
    expect(screen.getAllByLabelText('Open date picker')).toHaveLength(2)
  })

  it('renders clock button for TIME columns', () => {
    renderForm(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    expect(screen.getByTestId('calendar-btn-login_time')).toBeInTheDocument()
    expect(screen.getByLabelText('Open time picker')).toBeInTheDocument()
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
    renderForm(
      <ResultFormView
        {...temporalDefaultProps}
        {...buildTemporalEditProps({
          editState: nullEditState,
          onUpdateCell,
        })}
      />
    )
    // Toggle NULL off for created_at (DATETIME column)
    fireEvent.click(screen.getByTestId('btn-null-created_at'))
    // Should be called with a date string (not empty string)
    expect(onUpdateCell).toHaveBeenCalledWith(
      1,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    )
  })

  it('clicking calendar button opens date picker for non-null temporal field', () => {
    renderForm(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    // Click the calendar button for created_at (DATETIME) which is non-null
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    // The DateTimePicker should now be rendered (portal-based)
    // Verify picker controls appear (Apply / Cancel buttons from DateTimePicker)
    expect(screen.getByText('Apply')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('applying date picker value calls onUpdateCell and closes picker', () => {
    const onUpdateCell = vi.fn()
    renderForm(
      <ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps({ onUpdateCell })} />
    )
    // Open picker for created_at (DATETIME)
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByText('Apply')).toBeInTheDocument()
    // Click Apply to close the picker with the current value
    fireEvent.click(screen.getByText('Apply'))
    // onUpdateCell should have been called with the value
    expect(onUpdateCell).toHaveBeenCalledWith(1, expect.any(String))
    // Picker should be dismissed
    expect(screen.queryByText('Apply')).not.toBeInTheDocument()
  })

  it('toggling NULL on closes open picker for that field', () => {
    const onUpdateCell = vi.fn()
    renderForm(
      <ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps({ onUpdateCell })} />
    )
    // Open picker for created_at
    fireEvent.click(screen.getByTestId('calendar-btn-created_at'))
    expect(screen.getByText('Apply')).toBeInTheDocument()
    // Toggle NULL on for created_at
    fireEvent.click(screen.getByTestId('btn-null-created_at'))
    // Picker should be dismissed (toggling NULL closes open picker)
    expect(screen.queryByText('Apply')).not.toBeInTheDocument()
    // Should have set value to null
    expect(onUpdateCell).toHaveBeenCalledWith(1, null)
  })

  it('clicking temporal input opens picker on first focus (first-click-open)', () => {
    renderForm(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    const input = screen.getByTestId('form-input-created_at') // created_at DATETIME
    // Click the input — this fires focus + click; since input wasn't already focused,
    // the onClick handler should open the picker
    fireEvent.click(input)
    // DateTimePicker should now be visible
    expect(screen.getByText('Apply')).toBeInTheDocument()
  })

  it('blurring temporal input resets focus tracking', () => {
    renderForm(<ResultFormView {...temporalDefaultProps} {...buildTemporalEditProps()} />)
    const input = screen.getByTestId('form-input-created_at') // created_at DATETIME
    // Focus and then blur to exercise the onBlur handler
    fireEvent.focus(input)
    fireEvent.blur(input)
    // No crash; the ref is reset — verify component is still rendered
    expect(screen.getByTestId('form-input-created_at')).toBeInTheDocument()
  })
})
