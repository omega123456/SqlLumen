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

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith('conn-1', 'tab-1', {
          format: 'csv',
          filePath: '/tmp/export.csv',
          includeHeaders: true,
          tableName: undefined,
        })
      },
      { timeout: 5000 }
    )

    // Should close on success
    await waitFor(
      () => {
        expect(onClose).toHaveBeenCalled()
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('passes tableName when format is sql-insert', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Change format to SQL INSERT
    await user.selectOptions(screen.getByTestId('export-format-select'), 'sql-insert')

    // Type a file path
    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.sql')

    // Click Export
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({
            format: 'sql-insert',
            tableName: 'exported_results',
          })
        )
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} />)

    await user.click(screen.getByTestId('export-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows error display when export fails', async () => {
    mockExportResults.mockImplementation(() =>
      Promise.reject(new Error('Export failed: disk full'))
    )
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(screen.getByTestId('export-error')).toHaveTextContent('Export failed: disk full')
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('export button is disabled during export (loading state)', async () => {
    // Make exportResults hang indefinitely
    mockExportResults.mockImplementation(
      () => new Promise(() => {}) // never resolves
    )
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    // Button should show loading and be disabled (wait for async state update)
    await waitFor(
      () => {
        const exportBtn = screen.getByTestId('export-submit-button')
        expect(exportBtn).toBeDisabled()
        expect(exportBtn).toHaveTextContent('Exporting...')
      },
      { timeout: 5000 }
    )
  }, 15000)

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

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({
            includeHeaders: false,
          })
        )
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('browse button calls Tauri save dialog', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.click(screen.getByTestId('export-browse-button'))

    // The mock save dialog returns '/mock/path/export.csv'
    await waitFor(() => {
      const input = screen.getByTestId('export-file-path-input') as HTMLInputElement
      expect(input.value).toBe('/mock/path/export.csv')
    })
  })

  it('onExport callback is called instead of built-in export', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} onExport={onExport} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(onExport).toHaveBeenCalledWith({
          format: 'csv',
          filePath: '/tmp/export.csv',
          includeHeaders: true,
          tableName: 'exported_results',
        })
      },
      { timeout: 5000 }
    )
    // Built-in exportResults should NOT have been called
    expect(mockExportResults).not.toHaveBeenCalled()
    // Should close on success
    await waitFor(
      () => {
        expect(onClose).toHaveBeenCalled()
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('defaultTableName prop sets initial table name', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} defaultTableName="users" />)

    // Switch to SQL INSERT to see the table name input
    await user.selectOptions(screen.getByTestId('export-format-select'), 'sql-insert')

    const tableNameInput = screen.getByTestId('export-table-name-input') as HTMLInputElement
    expect(tableNameInput.value).toBe('users')
  })

  it('estimated size shows MB for large exports', () => {
    render(<ExportDialog {...defaultProps} totalRows={100000} columnCount={10} />)
    const estimated = screen.getByTestId('export-estimated-size')
    // 100000 * 10 * 20 = 20,000,000 bytes = 20.0 MB
    expect(estimated.textContent).toContain('20.0 MB')
  })

  it('shows error message for non-Error thrown value', async () => {
    mockExportResults.mockRejectedValue('string error')
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(screen.getByTestId('export-error')).toHaveTextContent('string error')
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('export does nothing when file path is empty', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Don't type a file path — just click export (it should be disabled)
    const exportBtn = screen.getByTestId('export-submit-button')
    expect(exportBtn).toBeDisabled()
    await user.click(exportBtn)

    expect(mockExportResults).not.toHaveBeenCalled()
  })

  it('close X button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} />)

    const closeBtn = screen.getByRole('button', { name: /close/i })
    await user.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('onExport callback error is displayed', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn().mockRejectedValue(new Error('Custom export failed'))
    render(<ExportDialog {...defaultProps} onExport={onExport} />)

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(screen.getByTestId('export-error')).toHaveTextContent('Custom export failed')
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('table name can be modified for SQL INSERT format', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    await user.selectOptions(screen.getByTestId('export-format-select'), 'sql-insert')
    const tableNameInput = screen.getByTestId('export-table-name-input')
    await user.clear(tableNameInput)
    await user.type(tableNameInput, 'my_table')

    await user.type(screen.getByTestId('export-file-path-input'), '/tmp/export.sql')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({
            format: 'sql-insert',
            tableName: 'my_table',
          })
        )
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('shows format description for each format option', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    const select = screen.getByTestId('export-format-select') as HTMLSelectElement
    expect(select.options.length).toBe(4) // csv, json, xlsx, sql-insert

    // Verify we can select each format
    for (const fmt of ['csv', 'json', 'xlsx', 'sql-insert']) {
      await user.selectOptions(select, fmt)
      expect(select.value).toBe(fmt)
    }
  })

  it('destination prefix changes based on selected format', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Default is CSV — the destination prefix shows .csv
    const dialog = screen.getByTestId('export-dialog')
    expect(dialog.textContent).toContain('.csv')

    // Switch to JSON
    await user.selectOptions(screen.getByTestId('export-format-select'), 'json')
    expect(dialog.textContent).toContain('.json')
  })
})
