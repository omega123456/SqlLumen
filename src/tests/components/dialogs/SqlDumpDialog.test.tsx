import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SqlDumpDialog from '../../../components/dialogs/SqlDumpDialog'
import type { ExportableDatabase, DumpJobProgress } from '../../../lib/sql-dump-commands'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListExportableObjects = vi.fn()
const mockStartSqlDump = vi.fn()
const mockGetDumpProgress = vi.fn()

vi.mock('../../../lib/sql-dump-commands', () => ({
  listExportableObjects: (...args: unknown[]) => mockListExportableObjects(...args),
  startSqlDump: (...args: unknown[]) => mockStartSqlDump(...args),
  getDumpProgress: (...args: unknown[]) => mockGetDumpProgress(...args),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue('/mock/path/dump.sql'),
}))

const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()

vi.mock('../../../stores/toast-store', () => ({
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}))

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
  errorMessage: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** jsdom + focus trap: keyboard typing into file path is unreliable; drive controlled input directly. */
function setFilePath(path: string) {
  const input = screen.getByTestId('dump-file-path-input')
  fireEvent.change(input, { target: { value: path } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockListExportableObjects.mockResolvedValue(MOCK_DATABASES)
  mockStartSqlDump.mockResolvedValue('job-1')
  mockGetDumpProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
})

afterEach(() => {
  vi.useRealTimers()
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

    // Title
    expect(screen.getByRole('heading', { name: /Export SQL Dump/ })).toBeInTheDocument()

    // Option checkboxes
    await waitFor(() => {
      expect(screen.getByTestId('dump-include-structure')).toBeInTheDocument()
    })
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
    // Make listExportableObjects hang
    mockListExportableObjects.mockReturnValue(new Promise(() => {}))
    render(<SqlDumpDialog {...defaultProps} />)

    expect(screen.getByTestId('dump-loading-objects')).toBeInTheDocument()
  })

  it('shows error when object loading fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockListExportableObjects.mockRejectedValue(new Error('Connection lost'))
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-load-error')).toHaveTextContent('Connection lost')
    })
    consoleSpy.mockRestore()
  })

  it('renders object tree with databases and tables after loading', async () => {
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

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

    await waitFor(() => {
      expect(screen.getByTestId('dump-include-structure')).toBeChecked()
    })
    expect(screen.getByTestId('dump-include-data')).toBeChecked()
    expect(screen.getByTestId('dump-include-drop')).toBeChecked()
    expect(screen.getByTestId('dump-use-transaction')).toBeChecked()
  })

  it('option checkboxes toggle correctly', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-include-structure')).toBeChecked()
    })

    await user.click(screen.getByTestId('dump-include-structure'))
    expect(screen.getByTestId('dump-include-structure')).not.toBeChecked()

    await user.click(screen.getByTestId('dump-include-data'))
    expect(screen.getByTestId('dump-include-data')).not.toBeChecked()
  })

  it('schemaOnly prop unchecks data and changes title', async () => {
    render(<SqlDumpDialog {...defaultProps} schemaOnly />)

    // Title should be "Export Schema DDL"
    expect(screen.getByRole('heading', { name: /Export Schema DDL/ })).toBeInTheDocument()

    // Data checkbox should be unchecked
    await waitFor(() => {
      expect(screen.getByTestId('dump-include-data')).not.toBeChecked()
    })

    // Structure should still be checked
    expect(screen.getByTestId('dump-include-structure')).toBeChecked()
  })

  it('database checkbox selects/deselects all tables', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    // Toggle individual table
    await user.click(screen.getByTestId('dump-table-test_db-users'))
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).not.toBeChecked()

    // Toggle it off
    await user.click(screen.getByTestId('dump-table-test_db-users'))
    expect(screen.getByTestId('dump-table-test_db-users')).not.toBeChecked()
  })

  it('export button is disabled when no file path', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlDumpDialog {...defaultProps} />)

    // Wait for objects to load and select a table
    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })
    await user.click(screen.getByTestId('dump-db-test_db'))

    // No file path set
    expect(screen.getByTestId('dump-submit-button')).toBeDisabled()
  })

  it('export button is disabled when no selection', async () => {
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    // Set file path but no selection
    setFilePath('/tmp/dump.sql')
    expect(screen.getByTestId('dump-submit-button')).toBeDisabled()
  })

  it('export button calls startSqlDump with correct params', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    // Select test_db
    await user.click(screen.getByTestId('dump-db-test_db'))

    // Set file path
    setFilePath('/tmp/dump.sql')

    // Click Export
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(mockStartSqlDump).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        filePath: '/tmp/dump.sql',
        databases: ['test_db'],
        tables: {
          test_db: ['users', 'orders', 'user_stats_view'],
        },
        options: {
          includeStructure: true,
          includeData: true,
          includeDrop: true,
          useTransaction: true,
        },
      })
    })
  })

  it('shows error when export fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockStartSqlDump.mockRejectedValue(new Error('Permission denied'))
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-error')).toHaveTextContent('Permission denied')
    })
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('dump-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close X button calls onClose', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<SqlDumpDialog {...defaultProps} onClose={onClose} />)

    const closeBtn = screen.getByRole('button', { name: /close/i })
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('initialDatabase pre-selects all tables in that database', async () => {
    render(<SqlDumpDialog {...defaultProps} initialDatabase="test_db" />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    // All tables in test_db should be selected
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-user_stats_view')).toBeChecked()

    // other_db tables should NOT be selected
    expect(screen.getByTestId('dump-table-other_db-events')).not.toBeChecked()
  })

  it('initialTable pre-selects only that specific table', async () => {
    render(<SqlDumpDialog {...defaultProps} initialDatabase="test_db" initialTable="users" />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    // Only users should be selected
    expect(screen.getByTestId('dump-table-test_db-users')).toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-orders')).not.toBeChecked()
    expect(screen.getByTestId('dump-table-test_db-user_stats_view')).not.toBeChecked()
  })

  it('browse button calls Tauri save dialog', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlDumpDialog {...defaultProps} />)

    await user.click(screen.getByTestId('dump-browse-button'))

    await waitFor(() => {
      const input = screen.getByTestId('dump-file-path-input') as HTMLInputElement
      expect(input.value).toBe('/mock/path/dump.sql')
    })
  })

  it('shows selected count in objects label', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    // Select one table
    await user.click(screen.getByTestId('dump-table-test_db-users'))

    // Should show count
    expect(screen.getByText(/Objects to Export.*\(1\)/)).toBeInTheDocument()
  })

  it('footer text changes for schemaOnly mode', () => {
    render(<SqlDumpDialog {...defaultProps} schemaOnly />)

    expect(screen.getByTestId('dump-footer-text')).toHaveTextContent('DDL statements')
  })

  it('footer text shows background info for normal mode', () => {
    render(<SqlDumpDialog {...defaultProps} />)

    expect(screen.getByTestId('dump-footer-text')).toHaveTextContent('Large tables')
  })

  it('shows non-Error thrown value as error message', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockStartSqlDump.mockRejectedValue('string error')
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-error')).toHaveTextContent('string error')
    })
  })

  it('export button shows Exporting... while export is in progress', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // Make startSqlDump resolve but getDumpProgress never completes
    mockGetDumpProgress.mockReturnValue(new Promise(() => {}))
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('dump-submit-button')).toHaveTextContent('Exporting...')
      expect(screen.getByTestId('dump-submit-button')).toBeDisabled()
    })
  })

  it('shows "No databases found" when list is empty', async () => {
    mockListExportableObjects.mockResolvedValue([])
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByText('No databases found')).toBeInTheDocument()
    })
  })

  it('shows success toast when dump completes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetDumpProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument())
    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        'Export completed',
        expect.stringContaining('/tmp/dump.sql')
      )
    })
  })

  it('shows error toast when dump fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetDumpProgress.mockResolvedValue({
      jobId: 'job-1',
      status: 'failed',
      tablesTotal: 3,
      tablesDone: 1,
      currentTable: null,
      bytesWritten: 0,
      errorMessage: 'Disk full',
    })
    render(<SqlDumpDialog {...defaultProps} />)

    await waitFor(() => expect(screen.getByTestId('dump-object-tree')).toBeInTheDocument())
    await user.click(screen.getByTestId('dump-db-test_db'))
    setFilePath('/tmp/dump.sql')
    await user.click(screen.getByTestId('dump-submit-button'))

    await waitFor(() => {
      expect(mockShowErrorToast).toHaveBeenCalledWith('Export failed', 'Disk full')
    })
    consoleSpy.mockRestore()
  })
})
