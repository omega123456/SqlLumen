import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResultToolbar } from '../../../components/query-editor/ResultToolbar'
import { useQueryStore } from '../../../stores/query-store'
import { getFlatTabState } from '../../../stores/query-store'
import { makeTabState } from '../../helpers/query-test-utils'

/** Helper to set up store state for a tab. */
function setupTabState(tabId: string, overrides: Record<string, unknown> = {}) {
  useQueryStore.setState({
    tabs: {
      [tabId]: makeTabState(overrides),
    },
  })
}

/** Shorthand: get flat view for assertions. */
function flat(tabId: string) {
  return getFlatTabState(useQueryStore.getState().getTabState(tabId))
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockIPC(() => null)
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
    expect(screen.getByText('42 Rows')).toBeInTheDocument()
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

  it('shows "(1000 row limit applied)" when autoLimitApplied', () => {
    setupTabState(tabId, {
      status: 'success',
      totalRows: 42,
      autoLimitApplied: true,
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
    expect(screen.getByText('(500 row limit applied)')).toBeInTheDocument()
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
    expect(screen.queryByText('(1000 row limit applied)')).not.toBeInTheDocument()
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

  it('shows execution time', () => {
    setupTabState(tabId, {
      status: 'success',
      executionTimeMs: 42,
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
    expect(screen.getByText('(42ms)')).toBeInTheDocument()
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
    expect(screen.getByText('5 Rows')).toBeInTheDocument()
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
    expect(result.rows).toHaveLength(2)
    expect(result.selectedRowIndex).toBe(1)
    expect(result.editingRowIndex).toBe(1)
    expect(result.editState?.isNewRow).toBe(true)
  })
})
