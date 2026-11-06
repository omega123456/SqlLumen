import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultToolbar } from '../../../components/query-editor/ResultToolbar'
import { useQueryStore } from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { makeTabState, flat } from '../../helpers/query-test-utils'
import { expectToast, ipc } from '../../ipc-mock'

/** Helper to set up store state for a tab. */
function setupTabState(tabId: string, overrides: Record<string, unknown> = {}) {
  useQueryStore.setState({
    tabs: {
      [tabId]: makeTabState(overrides),
    },
  })
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
})

describe('ResultToolbar', () => {
  const tabId = 'tab-1'
  const connectionId = 'conn-1'

  it('renders with data-testid="result-toolbar"', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 10,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
  })

  it('renders success status with correct row count', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
        { name: 'email', dataType: 'VARCHAR' },
      ],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByText('42 rows')).toBeInTheDocument()
  })

  it('renders error status with error message', () => {
    setupTabState(tabId, {
      status: 'error',
      errorMessage: "Table 'users' doesn't exist",
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByText("Table 'users' doesn't exist")).toBeInTheDocument()
  })

  it('shows the applied (clamped) auto-limit from the response', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      autoLimitApplied: true,
      appliedRowLimit: 500,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByText('· 500-row limit applied')).toBeInTheDocument()
  })

  it('does not show auto-limit text when autoLimitApplied is false', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      autoLimitApplied: false,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.queryByText('· 1000-row limit applied')).not.toBeInTheDocument()
  })

  it('does not render pagination controls', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-size-select')).not.toBeInTheDocument()
  })

  it('disables copying when no rows are checked', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
      rows: [[1]],
      checkedRowIndices: [],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('btn-copy-selected-rows')).toBeDisabled()
  })

  it('copies checked query-result rows in display order', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    setupTabState(tabId, {
      status: 'success',
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
      ],
      rows: [
        [1, 'Ada'],
        [2, 'Grace'],
        [3, 'Linus, Jr.'],
      ],
      checkedRowIndices: [2, 0],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )

    await user.click(screen.getByTestId('btn-copy-selected-rows'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('id,name\r\n1,Ada\r\n3,"Linus, Jr."\r\n')
    })
    await expectToast('success', '2 row(s) copied to clipboard.')
    writeText.mockRestore()
  })

  it('shows an error toast when copying query-result rows fails', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('clipboard denied'))
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
      rows: [[1]],
      checkedRowIndices: [0],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )

    await user.click(screen.getByTestId('btn-copy-selected-rows'))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await expectToast('error', 'Copy failed')
    await expectToast('error', "Couldn't load all selected rows. Nothing was copied. Try again.")
    writeText.mockRestore()
  })

  it('shows total time', () => {
    setupTabState(tabId, {
      status: 'success',
      executionTimeMs: 12,
      totalTimeMs: 42,
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByText('42 ms')).toBeInTheDocument()
  })

  it('truncates long error messages to 200 chars', () => {
    const longError = 'A'.repeat(250)
    setupTabState(tabId, {
      status: 'error',
      errorMessage: longError,
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    const displayed = screen.getByText(/^A+/)
    expect(displayed.textContent!.length).toBeLessThanOrEqual(201) // 200 + ellipsis char
  })

  it('shows row count for DML results with affected rows', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 0,
      affectedRows: 5,
      columns: [],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    // Shared StatusArea shows "{N} Rows" when totalRows is provided
    expect(screen.getByText('5 rows')).toBeInTheDocument()
  })

  it('shows "Success" for DDL results with no affected rows', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 0,
      affectedRows: 0,
      columns: [],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    // Shared StatusArea shows "Success" when no totalRows
    expect(screen.getByText('Success')).toBeInTheDocument()
  })

  // --- View mode toggle tests ---

  it('renders view mode toggle buttons', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-text')).toBeInTheDocument()
  })

  it('sets view mode to form when form button clicked', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    fireEvent.click(screen.getByTestId('view-mode-form'))
    expect(flat(tabId).viewMode).toBe('form')
  })

  it('sets view mode to text when text button clicked', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    fireEvent.click(screen.getByTestId('view-mode-text'))
    expect(flat(tabId).viewMode).toBe('text')
  })

  // --- Export button tests ---

  it('renders export button', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('export-button')).toBeInTheDocument()
    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('export button is enabled when results exist', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('export-button')).not.toBeDisabled()
  })

  it('export button is disabled when no results (idle)', () => {
    setupTabState(tabId, { status: 'idle' })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('export-button')).toBeDisabled()
  })

  it('opens export dialog when export button clicked', () => {
    setupTabState(tabId, { status: 'success', columns: [{ name: 'id', dataType: 'INT' }] })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    fireEvent.click(screen.getByTestId('export-button'))
    expect(flat(tabId).exportDialogOpen).toBe(true)
  })

  // --- Data testid verification ---

  it('has correct data-testid attributes', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
    })
    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
      />
    )
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-text')).toBeInTheDocument()
    expect(screen.getByTestId('export-button')).toBeInTheDocument()
  })

  it('shows Clone before Save and Discard when editable result mode is active', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
      ],
      rows: [[1, 'Alice']],
      selectedRowIndex: 0,
      editMode: 'users',
      editingRowIndex: 0,
      editableColumnMap: new Map([
        [0, false],
        [1, true],
      ]),
      editColumnBindings: new Map([
        [0, 'id'],
        [1, 'name'],
      ]),
      editTableMetadata: {
        users: {
          database: 'app',
          table: 'users',
          columns: [],
          primaryKey: {
            keyColumns: ['id'],
            isUniqueKeyFallback: false,
          },
        },
      },
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1, name: 'Alice' },
        currentValues: { id: 1, name: 'Alicia' },
        modifiedColumns: new Set(['name']),
        isNewRow: false,
      },
    })

    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
        isCloneVisible
        isCloneDisabled={false}
      />
    )

    const actionTexts = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim())
      .filter((text): text is string => text === 'Clone' || text === 'Save' || text === 'Discard')

    expect(actionTexts).toEqual(['Clone', 'Save', 'Discard'])
  })

  it('keeps Clone visible when no unsaved edit exists while Save and Discard stay hidden', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
      rows: [[1]],
      selectedRowIndex: 0,
      editMode: 'users',
    })

    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
        isCloneVisible
        isCloneDisabled={false}
      />
    )

    expect(screen.getByTestId('query-clone-button')).toBeInTheDocument()
    expect(screen.getByTestId('query-clone-button')).toHaveAttribute(
      'title',
      'Clone selected row; primary key fields are left blank.'
    )
    expect(screen.queryByTestId('query-save-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('query-discard-button')).not.toBeInTheDocument()
  })

  it('disables Clone when the current view does not support selected-row cloning', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [{ name: 'id', dataType: 'INT' }],
      rows: [[1]],
      selectedRowIndex: 0,
      editMode: 'users',
      viewMode: 'text',
    })

    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
        isCloneVisible
        isCloneDisabled
      />
    )

    expect(screen.getByTestId('query-clone-button')).toBeDisabled()
  })

  it('clicking Clone selects and edits the cloned draft row', () => {
    setupTabState(tabId, {
      status: 'success',
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
      ],
      rows: [[1, 'Alice']],
      selectedRowIndex: 0,
      editMode: 'users',
      editableColumnMap: new Map([
        [0, false],
        [1, true],
      ]),
      editColumnBindings: new Map([
        [0, 'id'],
        [1, 'name'],
      ]),
      editBoundColumnIndexMap: new Map([
        ['id', 0],
        ['name', 1],
      ]),
      editConnectionId: 'conn-1',
      editTableMetadata: {
        users: {
          database: 'app',
          table: 'users',
          columns: [
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
              name: 'name',
              dataType: 'VARCHAR',
              isBooleanAlias: false,
              isNullable: true,
              isPrimaryKey: false,
              isUniqueKey: false,
              hasDefault: false,
              columnDefault: null,
              isBinary: false,
              isAutoIncrement: false,
            },
          ],
          primaryKey: {
            keyColumns: ['id'],
            isUniqueKeyFallback: false,
          },
        },
      },
    })

    render(
      <ResultToolbar
        tabId={tabId}
        connectionId={connectionId}
        filterModel={[]}
        onFilterClick={() => {}}
        onClearFilterClick={() => {}}
        isCloneVisible
        isCloneDisabled={false}
      />
    )

    fireEvent.click(screen.getByTestId('query-clone-button'))

    const result = flat(tabId)
    // The clone draft is a virtual row after the last view row.
    expect(result.rows).toHaveLength(1)
    expect(result.draftRow).not.toBeNull()
    expect(result.selectedRowIndex).toBe(1)
    expect(result.editingRowIndex).toBe(1)
    expect(result.editState?.isNewRow).toBe(true)
  })

  describe('delete checked rows (edit-mode DB delete)', () => {
    const props = {
      filterModel: [],
      onFilterClick: () => {},
      onClearFilterClick: () => {},
    }

    const editMetadata = {
      users: {
        database: 'testdb',
        table: 'users',
        columns: [],
        primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
        foreignKeys: [],
      },
    } as unknown as Record<string, import('../../../types/schema').QueryTableEditInfo>

    /** Edit-mode result bound to `users` with `id` (result index 0) as its key. */
    function setupDeletableTab(overrides: Record<string, unknown> = {}) {
      setupTabState(tabId, {
        status: 'success',
        columns: [
          { name: 'id', dataType: 'INT' },
          { name: 'name', dataType: 'VARCHAR' },
        ],
        rows: [
          [1, 'a'],
          [2, 'b'],
          [3, 'c'],
        ],
        totalRows: 3,
        editMode: 'users',
        editConnectionId: connectionId,
        lastExecutedSql: null,
        editTableMetadata: editMetadata,
        editBoundColumnIndexMap: new Map([
          ['id', 0],
          ['name', 1],
        ]),
        checkedRowIndices: [0, 2],
        ...overrides,
      })
    }

    it('does not render the delete button when no rows are checked', () => {
      setupDeletableTab({ checkedRowIndices: [] })
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)
      expect(screen.queryByTestId('query-delete-rows-button')).not.toBeInTheDocument()
    })

    it('does not render the delete button when not in edit mode (no unique key)', () => {
      setupDeletableTab({ editMode: null })
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)
      expect(screen.queryByTestId('query-delete-rows-button')).not.toBeInTheDocument()
    })

    it('renders a delete button with the checked count when rows are checked in edit mode', () => {
      setupDeletableTab()
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)
      expect(screen.getByTestId('query-delete-rows-button')).toHaveTextContent('Delete (2)')
    })

    it('confirms then deletes the checked rows and tombstones them (no re-run)', async () => {
      ipc.override('delete_table_row', () => undefined)
      ipc.override('remove_result_rows', () => ({ viewVersion: 2, viewRowCount: 1, totalRows: 1 }))
      setupDeletableTab()
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)

      // First click only opens the confirmation dialog — no delete yet.
      fireEvent.click(screen.getByTestId('query-delete-rows-button'))
      expect(ipc.calls('delete_table_row')).toHaveLength(0)
      expect(screen.getByRole('heading', { name: 'Delete rows' })).toBeInTheDocument()
      expect(screen.getByText('Delete 2 rows from users?')).toBeInTheDocument()
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-confirm-button')).toHaveTextContent('Delete 2 rows')

      fireEvent.click(screen.getByTestId('confirm-confirm-button'))

      await waitFor(() => expect(flat(tabId).totalRows).toBe(1))
      const calls = ipc.calls('delete_table_row') as Array<Record<string, unknown>>
      expect(calls.map((c) => c.pkValues)).toEqual([{ id: 1 }, { id: 3 }])
      expect(ipc.calls('remove_result_rows')[0]).toMatchObject({ baseIndices: [0, 2] })
      expect(ipc.calls('execute_query')).toHaveLength(0)
      expect(flat(tabId).checkedRanges).toEqual([])
    })

    it('uses the single-row copy for one checked row', () => {
      setupDeletableTab({ checkedRowIndices: [1] })
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)
      fireEvent.click(screen.getByTestId('query-delete-rows-button'))
      expect(screen.getByRole('heading', { name: 'Delete row' })).toBeInTheDocument()
      expect(screen.getByText('Delete this row from users?')).toBeInTheDocument()
      expect(screen.getByTestId('confirm-confirm-button')).toHaveTextContent('Delete row')
    })

    it('adds the long-running warning between 1,001 and 10,000 rows (wireframe 7)', () => {
      setupDeletableTab({ viewRowCount: 5000, checkedRanges: [[0, 4200]] })
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)
      expect(screen.getByTestId('query-delete-rows-button')).toHaveTextContent('Delete (4,200)')
      fireEvent.click(screen.getByTestId('query-delete-rows-button'))
      expect(screen.getByText('Delete 4,200 rows from users?')).toBeInTheDocument()
      expect(
        screen.getByText(
          "This can't be undone. Deleting more than 1,000 rows can take a while. If a row fails, rows already deleted stay deleted."
        )
      ).toBeInTheDocument()
      expect(screen.getByTestId('confirm-confirm-button')).toHaveTextContent('Delete 4,200 rows')
      expect(screen.getByTestId('confirm-cancel-button')).toBeInTheDocument()
    })

    it('blocks more than 10,000 rows with a single OK and deletes nothing (wireframe 7)', async () => {
      ipc.override('delete_table_row', () => undefined)
      setupDeletableTab({ viewRowCount: 100000, checkedRanges: [[0, 100000]] })
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)
      const deleteButton = screen.getByTestId('query-delete-rows-button')
      // Stays enabled so keyboard users can reach the explanation.
      expect(deleteButton).toBeEnabled()
      fireEvent.click(deleteButton)

      expect(
        screen.getByRole('heading', { name: 'Too many rows to delete at once' })
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'You have 100,000 rows checked. You can delete up to 10,000 rows at a time. Uncheck some rows, then try again.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByText('This action cannot be undone.')).not.toBeInTheDocument()
      expect(screen.queryByTestId('confirm-cancel-button')).not.toBeInTheDocument()
      const ok = screen.getByTestId('confirm-confirm-button')
      expect(ok).toHaveTextContent('OK')

      fireEvent.click(ok)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(ipc.calls('delete_table_row')).toHaveLength(0)
      expect(ipc.calls('fetch_result_window')).toHaveLength(0)
    })

    it('does not delete when the confirmation is cancelled', async () => {
      ipc.override('delete_table_row', () => undefined)
      setupDeletableTab()
      render(<ResultToolbar tabId={tabId} connectionId={connectionId} {...props} />)

      fireEvent.click(screen.getByTestId('query-delete-rows-button'))
      fireEvent.click(screen.getByTestId('confirm-cancel-button'))

      expect(ipc.calls('delete_table_row')).toHaveLength(0)
      expect(flat(tabId).rows).toHaveLength(3)
      expect(ipc.calls('remove_result_rows')).toHaveLength(0)
    })
  })

  describe('windowed status (wireframes 1, 2, 3 and 8)', () => {
    const props = {
      filterModel: [],
      onFilterClick: () => {},
      onClearFilterClick: () => {},
    }

    it('shows the filtered count against the live total', () => {
      setupTabState(tabId, {
        status: 'success',
        totalRows: 12340,
        viewRowCount: 2340,
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      render(
        <ResultToolbar
          {...props}
          tabId={tabId}
          connectionId={connectionId}
          filterModel={[{ column: 'id', operator: '>', value: '1' }]}
        />
      )
      expect(screen.getByTestId('result-row-count')).toHaveTextContent('2,340 of 12,340 rows')
    })

    it('replaces the auto-limit segment with the truncated segment', () => {
      setupTabState(tabId, {
        status: 'success',
        totalRows: 100000,
        viewRowCount: 100000,
        truncated: true,
        autoLimitApplied: true,
        appliedRowLimit: 500,
        totalTimeMs: 51,
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('result-row-count')).toHaveTextContent('100,000+ rows · truncated')
      expect(screen.queryByText(/row limit applied/)).not.toBeInTheDocument()
      expect(screen.getByTestId('status-execution-time')).toHaveTextContent('51 ms')
    })

    it('shows "Filtering…" while a filter request is pending, without hiding the count', () => {
      setupTabState(tabId, {
        status: 'success',
        totalRows: 10,
        isFiltering: true,
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('result-filtering-status')).toHaveTextContent('Filtering…')
      expect(screen.getByTestId('result-row-count')).toHaveTextContent('10 rows')
    })

    it('shows "Loading rows X–Y…" next to the still-visible count and announces it once', () => {
      setupTabState(tabId, {
        status: 'success',
        totalRows: 100000,
        viewRowCount: 100000,
        pendingWindowRange: [12000, 13000],
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('status-success')).toBeInTheDocument()
      expect(screen.getByTestId('result-window-loading')).toHaveTextContent(
        'Loading rows 12,001–13,000…'
      )
      expect(screen.getByRole('status')).toHaveTextContent('Loading rows 12,001–13,000…')
    })

    it('shows the action progress with Cancel after 1 s and hides the count', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      setupTabState(tabId, {
        status: 'success',
        totalRows: 12340,
        queryId: 'q-1',
        columns: [{ name: 'id', dataType: 'INT' }],
      })
      useQueryStore.getState().beginRowAction(tabId, 'Copying', 12340, onCancel)
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      // Under 1 s nothing changes, but the toolbar Copy button is disabled.
      expect(screen.queryByTestId('status-loading')).not.toBeInTheDocument()

      act(() => {
        const result = useQueryStore.getState().tabs[tabId]!.results[0]
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            [tabId]: {
              ...state.tabs[tabId]!,
              results: [
                {
                  ...result,
                  rowActionProgress: { ...result.rowActionProgress!, done: 4000, visible: true },
                },
              ],
            },
          },
        }))
      })
      expect(screen.getByTestId('status-loading')).toHaveTextContent('Copying… 4,000 of 12,340')
      expect(screen.queryByTestId('result-row-count')).not.toBeInTheDocument()
      await user.click(screen.getByTestId('row-action-cancel'))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('shows the delete progress without Cancel', () => {
      setupTabState(tabId, {
        status: 'success',
        totalRows: 4200,
        columns: [{ name: 'id', dataType: 'INT' }],
        rowActionProgress: {
          verb: 'Deleting',
          done: 1200,
          total: 4200,
          cancellable: false,
          visible: true,
        },
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('status-loading')).toHaveTextContent('Deleting… 1,200 of 4,200')
      expect(screen.queryByTestId('row-action-cancel')).not.toBeInTheDocument()
      expect(screen.getByTestId('btn-copy-selected-rows')).toBeDisabled()
    })

    it('copies checked view ranges that span unloaded rows by fetching them first', async () => {
      const user = userEvent.setup()
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        rows: [[0]],
        viewRowCount: 3000,
        totalRows: 3000,
        checkedRanges: [[0, 3000]],
      })
      ipc.override('fetch_result_window', (args) => {
        const offset = Number(args?.offset)
        const limit = Number(args?.limit)
        const windowRows = Array.from({ length: limit }, (_, i) => [offset + i])
        return {
          offset,
          rows: windowRows,
          baseIndices: windowRows.map((row) => row[0]),
          viewRowCount: 3000,
          viewVersion: 1,
        }
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('btn-copy-selected-rows'))
      await waitFor(() => expect(writeText).toHaveBeenCalled())
      const csv = writeText.mock.lastCall?.[0] as string
      expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3001)
      const limits = (ipc.calls('fetch_result_window') as Array<{ limit: number }>).map(
        (c) => c.limit
      )
      expect(Math.max(...limits)).toBeLessThanOrEqual(2000)
      writeText.mockRestore()
    })

    it('shows the wireframe 8 toast when checked rows cannot be loaded', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        rows: [],
        viewRowCount: 3000,
        totalRows: 3000,
        checkedRanges: [[0, 3000]],
      })
      ipc.override('fetch_result_window', () => {
        throw new Error('offline')
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('btn-copy-selected-rows'))
      await expectToast('error', "Couldn't load all selected rows. Nothing was copied. Try again.")
    })

    it('routes results_expired while copying checked rows to the expired block', async () => {
      const user = userEvent.setup()
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        rows: [],
        viewRowCount: 3000,
        totalRows: 3000,
        checkedRanges: [[0, 3000]],
      })
      ipc.override('fetch_result_window', () => {
        throw new Error('results_expired: gone')
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      await user.click(screen.getByTestId('btn-copy-selected-rows'))
      await waitFor(() => expect(flat(tabId).isExpired).toBe(true))
    })

    it('ignores checked ranges of an older view', () => {
      setupTabState(tabId, {
        status: 'success',
        columns: [{ name: 'id', dataType: 'INT' }],
        rows: [[1]],
        viewVersion: 2,
        checkedRanges: [[0, 1]],
        checkedViewVersion: 1,
      })
      render(<ResultToolbar {...props} tabId={tabId} connectionId={connectionId} />)
      expect(screen.getByTestId('btn-copy-selected-rows')).toBeDisabled()
    })
  })
})
