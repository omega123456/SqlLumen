import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SqlDumpDialog from '../../../components/dialogs/SqlDumpDialog'
import type { ExportableDatabase, DumpJobProgress } from '../../../lib/sql-dump-commands'
import { ipc, expectToast } from '../../ipc-mock'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_DATABASES: ExportableDatabase[] = [
  {
    name: 'test_db',
    tables: [
      { name: 'users', objectType: 'table', estimatedRows: 1000 },
      { name: 'orders', objectType: 'table', estimatedRows: 5000 },
      { name: 'user_stats_view', objectType: 'view', estimatedRows: 0 },
    ],
  },
  {
    name: 'other_db',
    tables: [{ name: 'events', objectType: 'table', estimatedRows: 50000 }],
  },
]

const MOCK_PROGRESS_COMPLETED: DumpJobProgress = {
  jobId: 'job-1',
  status: 'completed',
  tablesTotal: 3,
  tablesDone: 3,
  currentTable: null,
  bytesWritten: 102400,
  rowsExported: 0,
  errorMessage: null,
  cancelRequested: false,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** jsdom + focus trap: keyboard typing into file path is unreliable; drive controlled input directly. */
function setFilePath(path: string) {
  const input = screen.getByTestId('dump-file-path-input')
  fireEvent.change(input, { target: { value: path } })
}

/** Wait until async object list load completes so subsequent updates run inside RTL act boundaries. */
async function waitForDumpDialogLoaded() {
  await screen.findByTestId('dump-object-tree')
}

beforeEach(() => {
  ipc.override('list_exportable_objects', () => MOCK_DATABASES)
  ipc.override('start_sql_dump', () => 'job-1')
  ipc.override('get_dump_progress', () => MOCK_PROGRESS_COMPLETED)
  ipc.override('plugin:dialog|save', () => '/mock/path/dump.sql')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqlDumpDialog', () => {
  const defaultProps = {
    connectionId: 'conn-1',
    onClose: vi.fn(),
  }

  it('renders dialog with title, options, object tree, file path, and buttons', async () => {
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    // Title
    expect(screen.getByRole('heading', { name: /Export SQL Dump/ })).toBeInTheDocument()

    // Option checkboxes
    expect(screen.getByTestId('dump-include-structure')).toBeInTheDocument()
    expect(screen.getByTestId('dump-include-data')).toBeInTheDocument()
    expect(screen.getByTestId('dump-include-drop')).toBeInTheDocument()
    expect(screen.getByTestId('dump-use-transaction')).toBeInTheDocument()

    // File path input and browse button
    expect(screen.getByTestId('dump-file-path-input')).toBeInTheDocument()
    expect(screen.getByTestId('dump-browse-button')).toBeInTheDocument()

    // Buttons
    expect(screen.getByTestId('dump-submit-button')).toBeInTheDocument()
    expect(screen.getByTestId('dump-cancel-button')).toBeInTheDocument()
  })

  it('shows loading state while objects are being fetched', () => {
    // Make list_exportable_objects hang
    ipc.override('list_exportable_objects', () => new Promise(() => {}))
    render(<SqlDumpDialog {...defaultProps} />)

    expect(screen.getByTestId('dump-loading-objects')).toBeInTheDocument()
  })

  it('shows error when object loading fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('list_exportable_objects', () => {
      throw new Error('Connection lost')
    })
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-load-error')).toHaveTextContent('Connection lost')
    })
    consoleSpy.mockRestore()
  })

  it('renders object tree with databases and tables after loading', async () => {
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    // Database checkboxes
    expect(screen.getByTestId('dump-db-test_db')).toBeInTheDocument()
    expect(screen.getByTestId('dump-db-other_db')).toBeInTheDocument()

    // Table checkboxes
    expect(screen.getByTestId('dump-table-test_db-users')).toBeInTheDocument()
    expect(screen.getByTestId('dump-table-test_db-orders')).toBeInTheDocument()
    expect(screen.getByTestId('dump-table-test_db-user_stats_view')).toBeInTheDocument()
    expect(screen.getByTestId('dump-table-other_db-events')).toBeInTheDocument()
  })

  it('options checkboxes default correctly', async () => {
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    expect(screen.getByTestId('dump-include-structure')).toBeChecked()
    expect(screen.getByTestId('dump-include-data')).toBeChecked()
    expect(screen.getByTestId('dump-include-drop')).toBeChecked()
    expect(screen.getByTestId('dump-use-transaction')).toBeChecked()
  })

  it('option checkboxes toggle correctly', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    expect(screen.getByTestId('dump-include-structure')).toBeChecked()

    await user.click(screen.getByTestId('dump-include-structure'))
    expect(screen.getByTestId('dump-include-structure')).not.toBeChecked()

    await user.click(screen.getByTestId('dump-include-data'))
    expect(screen.getByTestId('dump-include-data')).not.toBeChecked()
  })

  it('schemaOnly prop unchecks data and changes title', async () => {
    render(<SqlDumpDialog {...defaultProps} schemaOnly />)
    await waitForDumpDialogLoaded()

    // Title should be "Export Schema DDL"
    expect(screen.getByRole('heading', { name: /Export Schema DDL/ })).toBeInTheDocument()

    // Data checkbox should be unchecked
    expect(screen.getByTestId('dump-include-data')).not.toBeChecked()

    // Structure should still be checked
    expect(screen.getByTestId('dump-include-structure')).toBeChecked()
  })

  it('database checkbox selects/deselects all tables', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)

    await waitForDumpDialogLoaded()

    // Initially no tables selected
    expect(screen.getByTestId('dump-table-test_db-users')).not.toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).not.toBeChecked()

    // Click database checkbox to select all
    await user.click(screen.getByTestId('dump-db-test_db'))

    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-user_stats_view')).toBeChecked()

    // Click again to deselect all
    await user.click(screen.getByTestId('dump-db-test_db'))

    expect(screen.getByTestId('dump-table-test_db-users')).not.toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).not.toBeChecked()
  })

  it('individual table checkbox toggles correctly', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    // Toggle individual table
    await user.click(screen.getByTestId('dump-table-test_db-users'))
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).not.toBeChecked()

    // Toggle it off
    await user.click(screen.getByTestId('dump-table-test_db-users'))
    expect(screen.getByTestId('dump-table-test_db-users')).not.toBeChecked()
  })

  it('export button is disabled when no file path', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)

    await waitForDumpDialogLoaded()
    await user.click(screen.getByTestId('dump-db-test_db'))

    // No file path set
    expect(screen.getByTestId('dump-submit-button')).toBeDisabled()
  })

  it('export button is disabled when no selection', async () => {
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    // Set file path but no selection
    setFilePath('/tmp/dump.sql')
    expect(screen.getByTestId('dump-submit-button')).toBeDisabled()
  })

  it('export button calls start_sql_dump IPC with selected-object entries including types', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)
    await waitForDumpDialogLoaded()

    // Select test_db (has tables + a view)
    await user.click(screen.getByTestId('dump-db-test_db'))

    // Set file path
    setFilePath('/tmp/dump.sql')

    // Click Export
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      const calls = ipc.calls('start_sql_dump')
      expect(calls).toHaveLength(1)
      const args = calls[0] as Record<string, unknown>
      const input = args.input as Record<string, unknown>
      const tables = input.tables as Record<string, Array<{ name: string; objectType: string }>>
      // Verify tables are sent as DumpTableEntry with objectType
      const testDbEntries = tables.test_db
      expect(testDbEntries).toHaveLength(3)
      // Find specific entries by name
      const usersEntry = testDbEntries.find((e) => e.name === 'users')
      const ordersEntry = testDbEntries.find((e) => e.name === 'orders')
      const viewEntry = testDbEntries.find((e) => e.name === 'user_stats_view')
      expect(usersEntry).toEqual({ name: 'users', objectType: 'table' })
      expect(ordersEntry).toEqual({ name: 'orders', objectType: 'table' })
      expect(viewEntry).toEqual({ name: 'user_stats_view', objectType: 'view' })
      // Verify other input fields
      expect(input).toMatchObject({
        connectionId: 'conn-1',
        filePath: '/tmp/dump.sql',
        databases: ['test_db'],
        options: {
          includeStructure: true,
          includeData: true,
          includeDrop: true,
          useTransaction: true,
        },
      })
    })
  })

  it('blocks export when selected metadata is missing and does not call start_sql_dump', async () => {
    const user = userEvent.setup()

    // Use a mutable metadata array so we can remove a table after loading
    const mutableDatabases: ExportableDatabase[] = [
      {
        name: 'test_db',
        tables: [
          { name: 'users', objectType: 'table', estimatedRows: 1000 },
          { name: 'orders', objectType: 'table', estimatedRows: 5000 },
        ],
      },
    ]
    ipc.override('list_exportable_objects', () => mutableDatabases)

    render(<SqlDumpDialog {...defaultProps} initialDatabase="test_db" />)
    await waitForDumpDialogLoaded()

    // All tables are pre-selected via initialDatabase
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).toBeChecked()

    setFilePath('/tmp/dump.sql')

    // Now mutate the metadata array in-place to remove 'users' from the tables.
    // The component's `databases` state holds this same array reference, so
    // when handleExport iterates it at export time, the table will be missing.
    mutableDatabases[0].tables = [{ name: 'orders', objectType: 'table', estimatedRows: 5000 }]

    // Click Export — should detect missing metadata for 'users'
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-error')).toHaveTextContent(/metadata not found for "users"/)
    })

    // Verify no start_sql_dump IPC call was made
    expect(ipc.calls('start_sql_dump')).toHaveLength(0)

    // Verify the submit button is not in the exporting state (not disabled/replaced)
    expect(screen.getByTestId('dump-submit-button')).toBeInTheDocument()
  })

  it('shows error when export fails', async () => {
    const user = userEvent.setup()
    ipc.override('start_sql_dump', () => {
      throw new Error('Permission denied')
    })
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-error')).toHaveTextContent('Permission denied')
    })
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)
    await waitForDumpDialogLoaded()

    await user.click(screen.getByTestId('dump-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close X button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)
    await waitForDumpDialogLoaded()

    const closeBtn = screen.getByRole('button', { name: /close/i })
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('initialDatabase pre-selects all tables in that database', async () => {
    render(<SqlDumpDialog {...defaultProps} initialDatabase="test_db" />)
    await waitForDumpDialogLoaded()

    // All tables in test_db should be selected
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-user_stats_view')).toBeChecked()

    // other_db tables should NOT be selected
    expect(screen.getByTestId('dump-table-other_db-events')).not.toBeChecked()
  })

  it('initialTable pre-selects only that specific table', async () => {
    render(<SqlDumpDialog {...defaultProps} initialDatabase="test_db" initialTable="users" />)
    await waitForDumpDialogLoaded()

    // Only users should be selected
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).not.toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-user_stats_view')).not.toBeChecked()
  })

  it('browse button calls Tauri save dialog', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    await user.click(screen.getByTestId('dump-browse-button'))

    await waitFor(() => {
      const input = screen.getByTestId('dump-file-path-input') as HTMLInputElement
      expect(input.value).toBe('/mock/path/dump.sql')
    })
  })

  it('shows selected count in objects label', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    // Select one table
    await user.click(screen.getByTestId('dump-table-test_db-users'))

    // Should show count
    expect(screen.getByText(/Objects to Export.*\(1\)/)).toBeInTheDocument()
  })

  it('footer text changes for schemaOnly mode', async () => {
    render(<SqlDumpDialog {...defaultProps} schemaOnly />)
    await waitForDumpDialogLoaded()

    expect(screen.getByTestId('dump-footer-text')).toHaveTextContent('DDL statements')
  })

  it('footer text shows background info for normal mode', async () => {
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    expect(screen.getByTestId('dump-footer-text')).toHaveTextContent(
      'Keep this dialog open while the export runs. Use Cancel Export to stop it.'
    )
  })

  it('shows non-Error thrown value as error message', async () => {
    const user = userEvent.setup()
    ipc.override('start_sql_dump', () => {
      throw 'string error'
    })
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-error')).toHaveTextContent('string error')
    })
  })

  it('shows cancel export button while export is in progress', async () => {
    const user = userEvent.setup()
    // Make get_dump_progress return running status
    ipc.override('get_dump_progress', () => ({
      jobId: 'mock-dump-job-1',
      status: 'running',
      tablesTotal: 2,
      tablesDone: 0,
      currentTable: 'test_db.users',
      bytesWritten: 0,
      rowsExported: 1000,
      errorMessage: null,
      cancelRequested: false,
    }))
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-cancel-export-button')).toHaveTextContent('Cancel Export')
      expect(screen.getByTestId('dump-cancel-export-button')).toBeEnabled()
    })
  })

  it('cannot be dismissed while export is in progress', async () => {
    const user = userEvent.setup()
    ipc.override('get_dump_progress', () => ({
      jobId: 'mock-dump-job-1',
      status: 'running',
      tablesTotal: 2,
      tablesDone: 0,
      currentTable: 'test_db.users',
      bytesWritten: 0,
      rowsExported: 1000,
      errorMessage: null,
      cancelRequested: false,
    }))
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)
    await waitForDumpDialogLoaded()

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-cancel-export-button')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    })

    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('sql-dump-dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows "No databases found" when list is empty', async () => {
    ipc.override('list_exportable_objects', () => [])
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('No databases found')).toBeInTheDocument()
    })
  })

  it('shows success toast when dump completes', async () => {
    const user = userEvent.setup()
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()
    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(async () => {
      await expectToast('success', 'Export completed')
    })
  })

  it('shows error toast when dump fails', async () => {
    const user = userEvent.setup()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ipc.override('get_dump_progress', () => ({
      jobId: 'job-1',
      status: 'failed',
      tablesTotal: 3,
      tablesDone: 1,
      currentTable: null,
      bytesWritten: 0,
      errorMessage: 'Disk full',
    }))
    render(<SqlDumpDialog {...defaultProps} />)
    await waitForDumpDialogLoaded()
    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(async () => {
      await expectToast('error', 'Export failed')
    })
    consoleSpy.mockRestore()
  })
})
