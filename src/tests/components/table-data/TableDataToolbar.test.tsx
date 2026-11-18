import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useToastStore } from '../../../stores/toast-store'
import type { TableDataTabState } from '../../../types/schema'
import { expectToast, ipc } from '../../ipc-mock'
import { makeTableDataTabState, setupTestConnection } from '../../helpers/table-data-test-utils'
import { makeTableColumnMeta } from '../../helpers/column-meta-fixtures'
import { TableDataToolbar } from '../../../components/table-data/TableDataToolbar'

const setupConnection = setupTestConnection

function makeDefaultTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
  return makeTableDataTabState({
    columns: [
      {
        name: 'id',
        dataType: 'bigint',
        isNullable: false,
        isPrimaryKey: true,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: true,
      },
    ],
    rows: [[1], [2], [3]],
    primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
    executionTimeMs: 15,
    ...overrides,
  })
}

function setupTabState(overrides: Partial<TableDataTabState> = {}) {
  useTableDataStore.setState({
    tabs: { 'tab-1': makeDefaultTabState(overrides) },
  })
}

beforeEach(() => {
  useTableDataStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
  })
  ipc.override('fetch_table_data', () => ({
    columns: [],
    rows: [],
    currentPage: 1,
    pageSize: 1000,
    primaryKey: null,
    executionTimeMs: 0,
  }))
  ipc.override('update_table_row', () => undefined)
  ipc.override('insert_table_row', () => [])
  ipc.override('delete_table_row', () => undefined)
})

describe('TableDataToolbar', () => {
  it('renders the writable toolbar with its controls in the shared data-view order', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({ selectedRowKey: { id: 1 } })
    render(<TableDataToolbar tabId="tab-1" />)

    const toolbar = screen.getByTestId('table-data-toolbar')
    expect(toolbar).not.toHaveTextContent('Success')
    expect(toolbar).not.toHaveTextContent('15 ms')
    expect(screen.queryByTestId('status-area')).not.toBeInTheDocument()
    const orderedTestIds = [
      'view-mode-grid',
      'btn-add-row',
      'btn-refresh',
      'btn-filter',
      'btn-export',
      'btn-copy-selected-rows',
      'pagination-page-input',
    ]
    const positions = orderedTestIds.map((testId) =>
      Array.from(toolbar.querySelectorAll('[data-testid]')).findIndex(
        (element) => element.getAttribute('data-testid') === testId
      )
    )
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)

    const rowActionNames = ['Add row', 'Clone row', 'Delete row']
    const buttonNames = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter((name) => rowActionNames.includes(name))
    expect(buttonNames).toEqual(['Add row', 'Clone row', 'Delete row'])
    expect(screen.getByTestId('btn-clone-row')).toHaveAttribute(
      'title',
      'Clone selected row; auto-increment, generated and binary key fields are left blank.'
    )

    expect(screen.getByTestId('view-mode-grid')).toHaveAttribute('data-active')
    expect(screen.getByTestId('btn-add-row')).not.toBeDisabled()
    expect(screen.getByTestId('btn-delete-row')).not.toBeDisabled()
    expect(screen.getByTestId('btn-export')).not.toBeDisabled()
    expect(screen.getByTestId('pagination-prev')).toBeDisabled()
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled()
    expect(screen.queryByTestId('readonly-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('filter-badge')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('page-size-select'))
    const labels = screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))
    expect(labels).toEqual(['100', '500', '1000', '5000'])
  })

  it('disables Add Row and shows the no-PK badge when the table has no primary key', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
    expect(screen.getByTestId('nopk-badge')).toBeInTheDocument()
  })

  it('disables Add Row, shows the read-only badge and disables copying when read-only with no checked rows', () => {
    setupConnection(true)
    setupTabState({ checkedRowKeys: [] })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
    expect(screen.getByTestId('readonly-badge')).toBeInTheDocument()
    const copyButton = screen.getByTestId('btn-copy-selected-rows')
    expect(copyButton).toBeDisabled()
    expect(copyButton).toHaveAttribute('title', 'Copy selected rows to clipboard')
    expect(copyButton).toHaveAccessibleName('Copy selected rows to clipboard')
  })

  it('disables Save, Discard, Clone and Delete without an edit state or selected row', () => {
    setupConnection()
    setupTabState({ editState: null, selectedRowKey: null })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-save')).toBeDisabled()
    expect(screen.getByTestId('btn-discard')).toBeDisabled()
    expect(screen.getByTestId('btn-clone-row')).toBeDisabled()
    expect(screen.getByTestId('btn-delete-row')).toBeDisabled()

    fireEvent.click(screen.getByTestId('btn-delete-row'))

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('Save button stays enabled for new rows seeded only by defaults', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: { status: 'active' },
        modifiedColumns: new Set<string>(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-save')).not.toBeDisabled()
  })

  it('enables both pagination buttons and shows the editable page input on a middle page', () => {
    setupConnection()
    setupTabState({ currentPage: 3 })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('pagination-prev')).not.toBeDisabled()
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled()
    expect(screen.queryByTestId('page-indicator')).not.toBeInTheDocument()
    expect(screen.getByTestId('pagination-page-input')).toHaveValue('3')
  })

  it('copies checked rows from a read-only keyless table in display order', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    setupConnection(true)
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
        {
          name: 'name',
          dataType: 'varchar',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [
        [1, 'Ada'],
        [2, 'Grace'],
        [3, 'Linus, Jr.'],
      ],
      primaryKey: null,
      checkedRowKeys: [{ __rowIndex: 2 }, { __rowIndex: 0 }],
    })
    render(<TableDataToolbar tabId="tab-1" />)

    await user.click(screen.getByTestId('btn-copy-selected-rows'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('id,name\r\n1,Ada\r\n3,"Linus, Jr."\r\n')
    })
    await expectToast('success', '2 row(s) copied to clipboard.')
    writeText.mockRestore()
  })

  it('copies every checked row from a primary-keyed table', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    setupConnection(true)
    setupTabState({ checkedRowKeys: [{ id: 1 }, { id: 2 }] })
    render(<TableDataToolbar tabId="tab-1" />)

    await user.click(screen.getByTestId('btn-copy-selected-rows'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('id\r\n1\r\n2\r\n')
    })
    await expectToast('success', '2 row(s) copied to clipboard.')
    writeText.mockRestore()
  })

  it('shows an error toast when copying checked rows fails', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('clipboard denied'))
    setupConnection(true)
    setupTabState({ checkedRowKeys: [{ id: 1 }] })
    render(<TableDataToolbar tabId="tab-1" />)

    await user.click(screen.getByTestId('btn-copy-selected-rows'))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await expectToast('error', 'clipboard denied')
    writeText.mockRestore()
  })

  it('page size change updates store', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({ pageSize: 1000 })
    render(<TableDataToolbar tabId="tab-1" />)
    const callsBefore = ipc.calls('fetch_table_data').length
    await user.click(screen.getByTestId('page-size-select'))
    await user.click(screen.getByRole('option', { name: '500' }))
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').length).toBeGreaterThan(callsBefore)
    })
  })

  it('export button opens export dialog', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    await user.click(screen.getByTestId('btn-export'))
    const tab = useTableDataStore.getState().tabs['tab-1']
    expect(tab?.isExportDialogOpen).toBe(true)
  })

  it('clicking Add Row calls insertNewRow', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    await user.click(screen.getByTestId('btn-add-row'))
    // insertNewRow is called on the store — verify no crash and editState is updated
    const state = useTableDataStore.getState().tabs['tab-1']
    // A new row editState should be created
    expect(state?.editState?.isNewRow).toBe(true)
  })

  it('Clone button is disabled when read-only, loading, or editing a draft row', () => {
    setupConnection(true)
    setupTabState({
      isLoading: true,
      selectedRowKey: { __tempId: 'temp-1' },
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: {},
        modifiedColumns: new Set(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    expect(screen.getByTestId('btn-clone-row')).toBeDisabled()
  })

  it('clicking Clone creates a selected draft row and saves through insert', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: true,
        },
        {
          name: 'name',
          dataType: 'varchar',
          isNullable: false,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [[1, 'Alice']],
      selectedRowKey: { id: 1 },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    await user.click(screen.getByTestId('btn-clone-row'))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.selectedRowKey).toEqual({ __tempId: state?.editState?.tempId })
    expect(state?.rows[state.rows.length - 1]).toEqual([null, 'Alice'])

    await user.click(screen.getByTestId('btn-save'))

    await waitFor(() => {
      expect(ipc.payloads('insert_table_row').length).toBeGreaterThan(0)
    })
  })

  it('clones the only checkbox-checked row of a composite natural-key table with every value copied', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({
      columns: [
        makeTableColumnMeta({ name: 'property_id', dataType: 'int', isPrimaryKey: true }),
        makeTableColumnMeta({ name: 'start_date', dataType: 'date', isPrimaryKey: true }),
        makeTableColumnMeta({ name: 'price', dataType: 'decimal' }),
      ],
      rows: [
        [17209, '2026-02-02', '440.00'],
        [17210, '2026-03-23', '430.00'],
      ],
      primaryKey: {
        keyColumns: ['property_id', 'start_date'],
        hasAutoIncrement: false,
        isUniqueKeyFallback: false,
      },
      selectedRowKey: null,
      checkedRowKeys: [
        { property_id: 17209, start_date: '2026-02-02' },
        { property_id: 17210, start_date: '2026-03-23' },
      ],
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-clone-row')).toBeDisabled()

    act(() => {
      useTableDataStore
        .getState()
        .setCheckedRowKeys('tab-1', [{ property_id: 17209, start_date: '2026-02-02' }])
    })
    await user.click(screen.getByTestId('btn-clone-row'))

    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.rows[state.rows.length - 1]).toEqual([17209, '2026-02-02', '440.00'])
    expect(state?.editState?.modifiedColumns).toEqual(
      new Set(['property_id', 'start_date', 'price'])
    )
  })

  it('clicking Delete Row shows the confirmation dialog and confirming deletes the row', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const deleteBtn = screen.getByTestId('btn-delete-row')
    expect(deleteBtn).not.toBeDisabled()

    await user.click(deleteBtn)

    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Delete row' })).toBeInTheDocument()
    expect(screen.getByText('Delete this row from users?')).toBeInTheDocument()
    expect(screen.getByTestId('confirm-confirm-button')).toHaveTextContent('Delete row')

    await user.click(screen.getByTestId('confirm-confirm-button'))

    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(ipc.payloads('delete_table_row').length).toBeGreaterThan(0)
    })
  })

  it('cancelling delete dialog does not delete', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    await user.click(screen.getByTestId('btn-delete-row'))
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Click cancel
    await user.click(screen.getByTestId('confirm-cancel-button'))

    // Dialog should close, but no delete occurred
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('disables Add Row and Delete while a new row is being edited', () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { __tempId: 'temp-1' },
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: {},
        modifiedColumns: new Set(),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
    expect(screen.getByTestId('btn-delete-row')).toBeDisabled()
  })

  it('bulk delete shows the checked count, confirms the row count and deletes all checked rows', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({
      editState: null,
      selectedRowKey: null,
      checkedRowKeys: [{ id: 1 }, { id: 2 }],
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const deleteBtn = screen.getByTestId('btn-delete-row')
    expect(deleteBtn).not.toBeDisabled()
    expect(deleteBtn).toHaveAccessibleName('Delete 2 rows')
    expect(screen.getByTestId('delete-count-badge')).toHaveTextContent('2')

    await user.click(deleteBtn)
    expect(screen.getByText('Delete rows')).toBeInTheDocument()
    expect(screen.getByText('Delete 2 rows from users?')).toBeInTheDocument()

    await user.click(screen.getByTestId('confirm-confirm-button'))

    await waitFor(() => {
      expect(ipc.payloads('delete_table_row').length).toBe(2)
    })
    expect(useTableDataStore.getState().tabs['tab-1'].checkedRowKeys).toEqual([])
  })

  it('bulk delete of a checked draft row removes only the draft, not a persisted row', async () => {
    const user = userEvent.setup()
    setupConnection()
    // Three persisted rows plus one appended draft row at the end.
    setupTabState({
      rows: [[1], [2], [3], [null]],
      selectedRowKey: { __tempId: 'temp-1' },
      checkedRowKeys: [{ id: 2 }, { __tempId: 'temp-1' }],
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: { id: null },
        modifiedColumns: new Set(['id']),
        isNewRow: true,
        tempId: 'temp-1',
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    await user.click(screen.getByTestId('btn-delete-row'))
    await user.click(screen.getByTestId('confirm-confirm-button'))

    // Exactly one persisted-row delete IPC call (id: 2). The draft is dropped
    // locally without IPC, and must not cause a second persisted row to vanish.
    await waitFor(() => {
      expect(ipc.payloads('delete_table_row').length).toBe(1)
    })

    const state = useTableDataStore.getState().tabs['tab-1']
    // Draft (appended) and persisted row id=2 removed; rows 1 and 3 remain.
    expect(state?.rows).toEqual([[1], [3]])
    expect(state?.editState).toBeNull()
    expect(state?.checkedRowKeys).toEqual([])

    // Success toast reports both deletions (draft + persisted), not over-counted.
    await expectToast('success', '2 rows deleted successfully.')
  })

  it('confirming delete discards edits when deleting the editing row', async () => {
    setupConnection()
    setupTabState({
      selectedRowKey: { id: 1 },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('btn-delete-row'))
    fireEvent.click(screen.getByTestId('confirm-confirm-button'))

    await waitFor(() => {
      expect(ipc.payloads('delete_table_row').length).toBeGreaterThan(0)
    })
    // editState should be cleared (discard + delete)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).toBeNull()
  })

  it('clicking Save calls saveCurrentRow', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const saveBtn = screen.getByTestId('btn-save')
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)
    await waitFor(() => {
      expect(ipc.payloads('update_table_row').length).toBeGreaterThan(0)
    })
  })

  it('clicking Discard calls discardCurrentRow', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    const discardBtn = screen.getByTestId('btn-discard')
    expect(discardBtn).not.toBeDisabled()
    fireEvent.click(discardBtn)
    const state = useTableDataStore.getState().tabs['tab-1']
    expect(state?.editState).toBeNull()
  })

  it('clicking Refresh calls refreshData', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)
    const callsBefore = ipc.calls('fetch_table_data').length
    const refreshBtn = screen.getByTestId('btn-refresh')
    expect(refreshBtn).not.toBeDisabled()
    fireEvent.click(refreshBtn)
    await waitFor(() => {
      expect(ipc.calls('fetch_table_data').length).toBeGreaterThan(callsBefore)
    })
  })

  it('clicking Grid View and Form View switches the view mode', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({ viewMode: 'form' })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('view-mode-form')).toHaveAttribute('data-active')

    await user.click(screen.getByTestId('view-mode-grid'))
    expect(useTableDataStore.getState().tabs['tab-1'].viewMode).toBe('grid')
    expect(screen.getByTestId('view-mode-grid')).toHaveAttribute('data-active')

    await user.click(screen.getByTestId('view-mode-form'))
    expect(useTableDataStore.getState().tabs['tab-1'].viewMode).toBe('form')
  })

  it('clicking Next Page fetches next page', async () => {
    setupConnection()
    setupTabState({ currentPage: 1 })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('pagination-next'))
    await waitFor(() => {
      expect(
        ipc
          .calls('fetch_table_data')
          .some((c) => (c as { payload: Record<string, unknown> }).payload.page === 2)
      ).toBe(true)
    })
  })

  it('submitting a page number fetches that page', async () => {
    const user = userEvent.setup()
    setupConnection()
    setupTabState({ currentPage: 2 })
    render(<TableDataToolbar tabId="tab-1" />)

    const pageInput = screen.getByTestId('pagination-page-input')
    await user.clear(pageInput)
    await user.type(pageInput, '7{Enter}')

    await waitFor(() => {
      expect(
        ipc
          .calls('fetch_table_data')
          .some((c) => (c as { payload: Record<string, unknown> }).payload.page === 7)
      ).toBe(true)
    })
  })

  it('clicking Prev Page fetches previous page', async () => {
    setupConnection()
    setupTabState({ currentPage: 2 })
    render(<TableDataToolbar tabId="tab-1" />)
    fireEvent.click(screen.getByTestId('pagination-prev'))
    await waitFor(() => {
      expect(
        ipc
          .calls('fetch_table_data')
          .some((c) => (c as { payload: Record<string, unknown> }).payload.page === 1)
      ).toBe(true)
    })
  })

  it('disables Export and Filter when the table data has not loaded', () => {
    setupConnection()
    setupTabState({ columns: [] })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-export')).toBeDisabled()
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
  })

  it('cancel button replaces refresh while loading, disables the other actions and invokes cancelLoad', async () => {
    const user = userEvent.setup()
    const cancelLoad = vi.fn()
    setupConnection()
    setupTabState({ isLoading: true })
    useTableDataStore.setState((state) => ({
      ...state,
      cancelLoad,
    }))
    render(<TableDataToolbar tabId="tab-1" />)

    expect(screen.queryByTestId('btn-refresh')).not.toBeInTheDocument()
    expect(screen.getByTestId('btn-add-row')).toBeDisabled()
    expect(screen.getByTestId('btn-export')).toBeDisabled()
    const cancelButton = screen.getByTestId('btn-cancel-load')
    expect(cancelButton).toBeEnabled()
    await user.click(cancelButton)
    expect(cancelLoad).toHaveBeenCalledWith('tab-1')
  })

  it('cancel button shows a cancelling state and is disabled', () => {
    setupConnection()
    setupTabState({ isLoading: true, isCancelling: true })
    render(<TableDataToolbar tabId="tab-1" />)

    const cancelButton = screen.getByTestId('btn-cancel-load')
    expect(cancelButton).toBeDisabled()
    expect(cancelButton).toHaveTextContent('Cancelling...')
  })

  it('Discard button is disabled when editState has no modifications', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-discard')).toBeDisabled()
    expect(screen.getByTestId('btn-save')).toBeDisabled()
  })

  it('Discard button is enabled when editState has modifications', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-discard')).not.toBeDisabled()
  })

  it('Discard button is enabled for an unsaved new row', () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { __tempId: 'temp-1' },
        originalValues: {},
        currentValues: {},
        modifiedColumns: new Set(),
        isNewRow: true,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)
    expect(screen.getByTestId('btn-discard')).not.toBeDisabled()
  })

  it('form view button is marked active when viewMode is form', () => {
    setupConnection()
    setupTabState({ viewMode: 'form' })
    render(<TableDataToolbar tabId="tab-1" />)
    const formBtn = screen.getByTestId('view-mode-form')
    expect(formBtn).toHaveAttribute('data-active')
  })
})

// ---------------------------------------------------------------------------
// Save validation — temporal field validation + toast tests
// ---------------------------------------------------------------------------

describe('TableDataToolbar — Save validation', () => {
  it('clicking Save with invalid temporal data shows error toast', async () => {
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: true,
        },
        {
          name: 'created_at',
          dataType: 'DATETIME',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: 'garbage' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    const saveBtn = screen.getByTestId('btn-save')
    expect(saveBtn).not.toBeDisabled()
    fireEvent.click(saveBtn)

    await waitFor(async () => {
      await expectToast('error', 'Invalid date value')
    })
  })

  it('clicking Save with valid data calls saveCurrentRow and shows success toast', async () => {
    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    const saveBtn = screen.getByTestId('btn-save')
    fireEvent.click(saveBtn)

    // Should NOT show error toast
    await waitFor(async () => {
      await expectToast('success', 'Row saved')
    })
  })

  it('clicking Save with blank temporal data shows error toast', async () => {
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: true,
        },
        {
          name: 'created_at',
          dataType: 'DATETIME',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: '' },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(async () => {
      await expectToast('error', 'Invalid date value')
    })
  })

  it('clicking Save shows an error toast when saving fails', async () => {
    let saveAttempts = 0
    ipc.override('update_table_row', () => {
      saveAttempts += 1
      if (saveAttempts === 1) {
        throw new Error('Save failed')
      }
      return undefined
    })

    setupConnection()
    setupTabState({
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Bob' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(async () => {
      await expectToast('error', 'Save failed')
    })
  })

  it('clicking Save with null temporal value does NOT show error', async () => {
    setupConnection()
    setupTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: true,
        },
        {
          name: 'created_at',
          dataType: 'DATETIME',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, created_at: '2023-01-01 00:00:00' },
        currentValues: { id: 1, created_at: null },
        modifiedColumns: new Set(['created_at']),
        isNewRow: false,
      },
    })
    render(<TableDataToolbar tabId="tab-1" />)

    fireEvent.click(screen.getByTestId('btn-save'))

    await waitFor(() => {
      expect(useToastStore.getState().toasts.some((toast) => toast.variant === 'error')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Filter button tests
// ---------------------------------------------------------------------------

describe('TableDataToolbar — Filter button', () => {
  it('applying conditions sets the badge count', async () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)

    // Open filter dialog
    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

    // Add a condition
    fireEvent.click(screen.getByTestId('filter-add-button'))
    // Apply
    fireEvent.click(screen.getByTestId('filter-apply-button'))

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByTestId('filter-dialog')).not.toBeInTheDocument()
    })

    // Badge should show count
    const badge = screen.getByTestId('filter-badge')
    expect(badge).toBeInTheDocument()
    expect(badge.textContent).toBe('1')
  })

  it('cancelling FilterDialog does not change badge state', () => {
    setupConnection()
    setupTabState()
    render(<TableDataToolbar tabId="tab-1" />)

    // Open and cancel
    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('filter-cancel-button'))

    // No badge
    expect(screen.queryByTestId('filter-badge')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// isView mode tests (Phase 3 — View Data mode)
// ---------------------------------------------------------------------------

describe('TableDataToolbar — isView mode', () => {
  it('shows the VIEW badge and hides the mutation buttons and the NO KEY badge for a view', () => {
    setupConnection()
    setupTabState({ primaryKey: null })
    render(<TableDataToolbar tabId="tab-1" isView={true} />)
    expect(screen.getByTestId('view-badge')).toBeInTheDocument()
    expect(screen.queryByTestId('nopk-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-add-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-delete-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-save')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-discard')).not.toBeInTheDocument()
  })
})

describe('filter button and dialog', () => {
  const setupConnection = setupTestConnection

  function makeDefaultTabState(overrides: Partial<TableDataTabState> = {}): TableDataTabState {
    return makeTableDataTabState({
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          isNullable: false,
          isPrimaryKey: true,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: true,
        },
        {
          name: 'name',
          dataType: 'varchar',
          isNullable: true,
          isPrimaryKey: false,
          isUniqueKey: false,
          hasDefault: false,
          columnDefault: null,
          isBinary: false,
          isBooleanAlias: false,
          isAutoIncrement: false,
        },
      ],
      rows: [
        [1, 'Alice'],
        [2, 'Bob'],
        [3, 'Charlie'],
      ],
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      executionTimeMs: 15,
      ...overrides,
    })
  }

  function setupTabState(overrides: Partial<TableDataTabState> = {}) {
    useTableDataStore.setState({
      tabs: { 'tab-1': makeDefaultTabState(overrides) },
    })
  }

  beforeEach(() => {
    useTableDataStore.setState({ tabs: {} })
    useConnectionStore.setState({ activeConnections: {}, activeTabId: null })
    useToastStore.setState({ toasts: [] })
    ipc.override('fetch_table_data', () => ({
      columns: [],
      rows: [],
      currentPage: 1,
      pageSize: 1000,
      primaryKey: null,
      executionTimeMs: 0,
    }))
    vi.clearAllMocks()
  })

  describe('TableDataToolbar — Clear Filter button', () => {
    it('clicking clear filter directly clears filters and shows toast (no confirm dialog)', async () => {
      setupConnection()
      setupTabState({
        filterModel: [{ column: 'name', operator: '==', value: 'Alice' }],
      })
      render(<TableDataToolbar tabId="tab-1" />)

      // Click clear filter — should clear immediately via withNavigationGuard (no edits pending)
      fireEvent.click(screen.getByTestId('btn-clear-filter'))

      // No confirm dialog should appear
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()

      // filterModel should be cleared
      await waitFor(() => {
        const tab = useTableDataStore.getState().tabs['tab-1']
        expect(tab?.filterModel).toEqual([])
      })

      // Toast should be shown
      await expectToast('success', 'Filters cleared')
    })
  })

  describe('TableDataToolbar — Filter auto-populate from selectedCell', () => {
    it('filter dialog opens with empty conditions when no selected cell', () => {
      setupConnection()
      setupTabState({ selectedCell: null })
      render(<TableDataToolbar tabId="tab-1" />)

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

      // Empty state should be visible (no conditions pre-populated)
      expect(screen.getByTestId('filter-empty-state')).toBeInTheDocument()
    })

    it('filter dialog auto-populates with selected cell value', async () => {
      setupConnection()
      setupTabState({
        selectedCell: { columnKey: 'name', value: 'Alice' },
      })
      render(<TableDataToolbar tabId="tab-1" />)

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

      // Should have a filter row pre-populated (not empty state)
      expect(screen.queryByTestId('filter-empty-state')).not.toBeInTheDocument()
      expect(screen.getByTestId('filter-row')).toBeInTheDocument()
      expect(screen.getByTestId('filter-column-select-0')).toHaveTextContent('name')
      expect(screen.getByTestId('filter-operator-select-0')).toHaveTextContent('==')
      expect(screen.getByTestId('filter-value-input')).toHaveValue('Alice')
      await waitFor(() => {
        expect(screen.getByTestId('filter-value-input')).toHaveFocus()
      })
    })

    it('filter dialog uses existing filterModel when filters are active (ignores selectedCell)', () => {
      setupConnection()
      setupTabState({
        filterModel: [{ column: 'id', operator: '>', value: '10' }],
        selectedCell: { columnKey: 'name', value: 'Alice' },
      })
      render(<TableDataToolbar tabId="tab-1" />)

      fireEvent.click(screen.getByTestId('btn-filter'))
      expect(screen.getByTestId('filter-dialog')).toBeInTheDocument()

      // Should show the existing filter condition, not the selected cell
      expect(screen.getByTestId('filter-row')).toBeInTheDocument()
    })
  })
})
