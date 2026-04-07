import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SqlImportDialog from '../../../components/dialogs/SqlImportDialog'
import type { ImportJobProgress } from '../../../lib/sql-dump-commands'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStartSqlImport = vi.fn()
const mockGetImportProgress = vi.fn()
const mockCancelImport = vi.fn()

vi.mock('../../../lib/sql-dump-commands', () => ({
  startSqlImport: (...args: unknown[]) => mockStartSqlImport(...args),
  getImportProgress: (...args: unknown[]) => mockGetImportProgress(...args),
  cancelImport: (...args: unknown[]) => mockCancelImport(...args),
}))

const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()
const mockShowWarningToast = vi.fn()

vi.mock('../../../stores/toast-store', () => ({
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
  showWarningToast: (...args: unknown[]) => mockShowWarningToast(...args),
}))

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_PROGRESS_RUNNING: ImportJobProgress = {
  jobId: 'job-1',
  status: 'running',
  statementsTotal: 100,
  statementsDone: 42,
  errors: [],
  stopOnError: true,
  cancelRequested: false,
}

const MOCK_PROGRESS_COMPLETED: ImportJobProgress = {
  jobId: 'job-1',
  status: 'completed',
  statementsTotal: 100,
  statementsDone: 100,
  errors: [],
  stopOnError: true,
  cancelRequested: false,
}

const MOCK_PROGRESS_COMPLETED_WITH_ERRORS: ImportJobProgress = {
  jobId: 'job-1',
  status: 'completed',
  statementsTotal: 100,
  statementsDone: 100,
  errors: [
    {
      statementIndex: 5,
      sqlPreview: 'INSERT INTO missing_tbl ...',
      errorMessage: "Table 'missing_tbl' doesn't exist",
    },
    {
      statementIndex: 23,
      sqlPreview: 'UPDATE bad_col ...',
      errorMessage: "Unknown column 'bad_col'",
    },
  ],
  stopOnError: false,
  cancelRequested: false,
}

const MOCK_PROGRESS_FAILED: ImportJobProgress = {
  jobId: 'job-1',
  status: 'failed',
  statementsTotal: 100,
  statementsDone: 5,
  errors: [
    {
      statementIndex: 5,
      sqlPreview: 'DROP TABLE critical ...',
      errorMessage: 'Permission denied',
    },
  ],
  stopOnError: true,
  cancelRequested: false,
}

const MOCK_PROGRESS_CANCELLED: ImportJobProgress = {
  jobId: 'job-1',
  status: 'cancelled',
  statementsTotal: 100,
  statementsDone: 30,
  errors: [],
  stopOnError: true,
  cancelRequested: true,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockStartSqlImport.mockResolvedValue('job-1')
  mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_RUNNING)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqlImportDialog', () => {
  const defaultProps = {
    connectionId: 'conn-1',
    filePath: '/path/to/dump.sql',
    onClose: vi.fn(),
  }

  it('renders dialog with title, file name, options, and buttons in idle state', () => {
    render(<SqlImportDialog {...defaultProps} />)

    // Title
    expect(screen.getByRole('heading', { name: /Import SQL Script/ })).toBeInTheDocument()

    // File path display (file name only)
    expect(screen.getByTestId('import-file-path')).toHaveTextContent('dump.sql')

    // Stop-on-error checkbox (checked by default)
    expect(screen.getByTestId('import-stop-on-error')).toBeChecked()

    // Import button
    expect(screen.getByTestId('import-submit-button')).toBeInTheDocument()
    expect(screen.getByTestId('import-submit-button')).toHaveTextContent('Import')
    expect(screen.getByTestId('import-submit-button')).toBeEnabled()

    // Cancel (dismiss) button
    expect(screen.getByTestId('import-dismiss-button')).toBeInTheDocument()

    // Footer text
    expect(screen.getByTestId('import-footer-text')).toHaveTextContent('Statements are executed')
  })

  it('displays only the file name (not full path)', () => {
    render(<SqlImportDialog {...defaultProps} filePath="C:\\Users\\data\\my-script.sql" />)
    expect(screen.getByTestId('import-file-path')).toHaveTextContent('my-script.sql')
  })

  it('stop-on-error checkbox toggles correctly', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlImportDialog {...defaultProps} />)

    expect(screen.getByTestId('import-stop-on-error')).toBeChecked()
    await user.click(screen.getByTestId('import-stop-on-error'))
    expect(screen.getByTestId('import-stop-on-error')).not.toBeChecked()
  })

  it('calls startSqlImport with correct params when Import clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(mockStartSqlImport).toHaveBeenCalledWith('conn-1', '/path/to/dump.sql', true)
    })
  })

  it('passes stopOnError=false when checkbox is unchecked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-stop-on-error'))
    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(mockStartSqlImport).toHaveBeenCalledWith('conn-1', '/path/to/dump.sql', false)
    })
  })

  it('shows "Importing..." and disables Import button while running', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // Make getImportProgress hang so status stays running
    mockGetImportProgress.mockReturnValue(new Promise(() => {}))
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-submit-button')).toHaveTextContent('Importing...')
      expect(screen.getByTestId('import-submit-button')).toBeDisabled()
    })
  })

  it('shows Cancel Import button while importing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockReturnValue(new Promise(() => {}))
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-cancel-button')).toBeInTheDocument()
    })
  })

  it('cancel button calls cancelImport with job ID', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_RUNNING)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-cancel-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('import-cancel-button'))

    await waitFor(() => {
      expect(mockCancelImport).toHaveBeenCalledWith('job-1')
    })
  })

  it('shows progress bar and count when progress is available', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_RUNNING)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-progress')).toBeInTheDocument()
      expect(screen.getByTestId('import-progress')).toHaveTextContent('42 / 100 statements')
      expect(screen.getByTestId('import-progress')).toHaveTextContent('42%')
    })
  })

  it('shows success status when completed without errors', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-status')).toHaveTextContent('Import completed successfully')
    })

    // Should show Close button (not Import or Cancel)
    expect(screen.getByTestId('import-done-button')).toBeInTheDocument()
    // Import button should not be shown
    expect(screen.queryByTestId('import-submit-button')).not.toBeInTheDocument()
  })

  it('shows completed with errors when import completes but has errors', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED_WITH_ERRORS)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-status')).toHaveTextContent(
        'Import completed with 2 errors'
      )
    })

    // Error list should be visible
    expect(screen.getByTestId('import-error-list')).toBeInTheDocument()
    expect(screen.getByTestId('import-error-0')).toHaveTextContent("Table 'missing_tbl'")
    expect(screen.getByTestId('import-error-1')).toHaveTextContent("Unknown column 'bad_col'")
  })

  it('shows failed status when stop-on-error triggers failure', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_FAILED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-status')).toHaveTextContent('Import stopped due to error')
    })

    // Error list should be visible
    expect(screen.getByTestId('import-error-list')).toBeInTheDocument()
    expect(screen.getByTestId('import-error-0')).toHaveTextContent('Permission denied')
  })

  it('shows cancelled status when import was cancelled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_CANCELLED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-status')).toHaveTextContent('Import was cancelled')
    })
  })

  it('close X button calls onClose in idle state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<SqlImportDialog {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('import-close-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('close X button is disabled while importing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockReturnValue(new Promise(() => {}))
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-close-button')).toBeDisabled()
    })
  })

  it('dismiss button calls onClose in idle state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    render(<SqlImportDialog {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('import-dismiss-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('done button calls onClose when terminal', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClose = vi.fn()
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
    render(<SqlImportDialog {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-done-button')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('import-done-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables stop-on-error checkbox while importing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockReturnValue(new Promise(() => {}))
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-stop-on-error')).toBeDisabled()
    })
  })

  it('disables stop-on-error checkbox when terminal', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-stop-on-error')).toBeDisabled()
    })
  })

  it('logs error when startSqlImport fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockStartSqlImport.mockRejectedValue(new Error('File not found'))
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        '[sql-import] Failed to start import:',
        expect.any(Error)
      )
    })

    // Should return to idle (Import button visible and enabled)
    await waitFor(() => {
      expect(screen.getByTestId('import-submit-button')).toBeEnabled()
      expect(screen.getByTestId('import-submit-button')).toHaveTextContent('Import')
    })
    consoleSpy.mockRestore()
  })

  it('error items display SQL preview when available', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED_WITH_ERRORS)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-error-0')).toHaveTextContent('INSERT INTO missing_tbl ...')
    })
  })

  it('displays 100% progress when completed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('import-progress')).toHaveTextContent('100 / 100 statements')
      expect(screen.getByTestId('import-progress')).toHaveTextContent('100%')
    })
  })

  it('shows success toast when import completes without errors', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(mockShowSuccessToast).toHaveBeenCalledWith(
        'Import completed',
        expect.stringContaining('100 statements')
      )
    })
  })

  it('shows warning toast when import completes with errors', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_COMPLETED_WITH_ERRORS)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Import completed with errors',
        expect.stringContaining('2 errors')
      )
    })
  })

  it('shows error toast when import fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_FAILED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(mockShowErrorToast).toHaveBeenCalledWith('Import failed', expect.any(String))
    })
  })

  it('shows warning toast when import is cancelled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    mockGetImportProgress.mockResolvedValue(MOCK_PROGRESS_CANCELLED)
    render(<SqlImportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('import-submit-button'))

    await waitFor(() => {
      expect(mockShowWarningToast).toHaveBeenCalledWith(
        'Import cancelled',
        expect.stringContaining('30 statements')
      )
    })
  })
})
