import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExportDialog from '../../../components/dialogs/ExportDialog'

// Mock the export-commands module
const mockExportResults = vi.fn()
vi.mock('../../../lib/export-commands', () => ({
  exportResults: (...args: unknown[]) => mockExportResults(...args),
}))

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn().mockResolvedValue('/mock/path/export.csv'),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockExportResults.mockResolvedValue({ bytesWritten: 1024, rowsExported: 5 })
})

describe('ExportDialog', () => {
  const defaultProps = {
    connectionId: 'conn-1',
    tabId: 'tab-1',
    columnCount: 3,
    totalRows: 100,
    onClose: vi.fn(),
  }

  it('renders format dropdown, file path input, checkbox, and buttons', () => {
    render(<ExportDialog {...defaultProps} />)

    expect(screen.getByTestId('export-format-select')).toBeInTheDocument()
    expect(screen.getByTestId('export-file-path-input')).toBeInTheDocument()
    expect(screen.getByTestId('export-include-headers-checkbox')).toBeInTheDocument()
    expect(screen.getByTestId('export-submit-button')).toBeInTheDocument()
    expect(screen.getByTestId('export-cancel-button')).toBeInTheDocument()
    expect(screen.getByTestId('export-browse-button')).toBeInTheDocument()
  })

  it('renders the dialog title', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.getByRole('heading', { name: /Export Results/ })).toBeInTheDocument()
  })

  it('format selector changes update state', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    const select = screen.getByTestId('export-format-select')
    await user.selectOptions(select, 'json')
    expect(select).toHaveValue('json')

    await user.selectOptions(select, 'xlsx')
    expect(select).toHaveValue('xlsx')

    await user.selectOptions(select, 'sql-insert')
    expect(select).toHaveValue('sql-insert')
  })

  it('export button is disabled when no file path', () => {
    render(<ExportDialog {...defaultProps} />)
    const exportBtn = screen.getByTestId('export-submit-button')
    expect(exportBtn).toBeDisabled()
  })

  it('export button is enabled when file path is provided', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    const input = screen.getByTestId('export-file-path-input')
    await user.type(input, '/tmp/export.csv')

    const exportBtn = screen.getByTestId('export-submit-button')
    expect(exportBtn).not.toBeDisabled()
  })

  it('export button calls exportResults IPC with correct options', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} />)

    // Type a file path
    const input = screen.getByTestId('export-file-path-input')
    await user.type(input, '/tmp/export.csv')

    // Click Export
    const exportBtn = screen.getByTestId('export-submit-button')
    await user.click(exportBtn)

    await waitFor(() => {
      expect(mockExportResults).toHaveBeenCalledWith('conn-1', 'tab-1', {
        format: 'csv',
        filePath: '/tmp/export.csv',
        includeHeaders: true,
        tableName: undefined,
      })
    })

    // Should close on success
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('passes tableName when format is sql-insert', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Change format to SQL INSERT
    await user.selectOptions(screen.getByTestId('export-format-select'), 'sql-insert')

    // Type a file path
    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.sql')

    // Click Export
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(() => {
      expect(mockExportResults).toHaveBeenCalledWith(
        'conn-1',
        'tab-1',
        expect.objectContaining({
          format: 'sql-insert',
          tableName: 'exported_results',
        })
      )
    })
  })

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('export-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows error display when export fails', async () => {
    mockExportResults.mockRejectedValue(new Error('Export failed: disk full'))
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('export-error')).toHaveTextContent('Export failed: disk full')
    })
  })

  it('export button is disabled during export (loading state)', async () => {
    // Make exportResults hang
    mockExportResults.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ bytesWritten: 0, rowsExported: 0 }), 5000)
        )
    )
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    // Button should show loading and be disabled
    const exportBtn = screen.getByTestId('export-submit-button')
    expect(exportBtn).toBeDisabled()
    expect(exportBtn).toHaveTextContent('Exporting...')
  })

  it('displays estimated size', () => {
    render(<ExportDialog {...defaultProps} />)
    const estimated = screen.getByTestId('export-estimated-size')
    expect(estimated).toBeInTheDocument()
    // 100 rows * 3 columns * 20 bytes = 6000 bytes = 6 KB
    expect(estimated.textContent).toContain('6 KB')
  })

  it('checkbox defaults to checked and can be toggled', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    const checkbox = screen.getByTestId('export-include-headers-checkbox')
    expect(checkbox).toBeChecked()

    await user.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })

  it('shows table name input when SQL INSERT format is selected', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Table name should not be visible initially (CSV format)
    expect(screen.queryByTestId('export-table-name-input')).not.toBeInTheDocument()

    // Change to SQL INSERT
    await user.selectOptions(screen.getByTestId('export-format-select'), 'sql-insert')

    // Table name input should appear
    expect(screen.getByTestId('export-table-name-input')).toBeInTheDocument()
    expect(screen.getByTestId('export-table-name-input')).toHaveValue('exported_results')
  })

  it('Escape key calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('unchecking headers sends includeHeaders: false', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Uncheck headers
    await user.click(screen.getByTestId('export-include-headers-checkbox'))

    // Type path and export
    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(() => {
      expect(mockExportResults).toHaveBeenCalledWith(
        'conn-1',
        'tab-1',
        expect.objectContaining({
          includeHeaders: false,
        })
      )
    })
  })
})
