import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const EXPORT_FORMAT_REGEX: Record<'csv' | 'json' | 'xlsx' | 'sql-insert', RegExp> = {
  csv: /CSV \(Comma Separated Values\)/,
  json: /JSON \(JavaScript Object Notation\)/,
  xlsx: /Excel \(\.xlsx\)/,
  'sql-insert': /SQL INSERT Statements/,
}

const EXPORT_FORMAT_LABELS = {
  csv: 'CSV (Comma Separated Values)',
  json: 'JSON (JavaScript Object Notation)',
  xlsx: 'Excel (.xlsx)',
  'sql-insert': 'SQL INSERT Statements',
} as const

const EXPORT_FORMAT_DESCRIPTIONS = [
  'Comma Separated Values',
  'JSON Array of Objects',
  'Excel Spreadsheet (.xlsx)',
  'SQL INSERT Statements',
] as const

async function pickExportFormat(
  user: ReturnType<typeof userEvent.setup>,
  formatKey: keyof typeof EXPORT_FORMAT_REGEX
) {
  const listbox = await openExportFormatListbox(user)
  fireEvent.click(within(listbox).getByRole('option', { name: EXPORT_FORMAT_REGEX[formatKey] }))
}

async function openExportFormatListbox(user: ReturnType<typeof userEvent.setup>) {
  // Get the trigger before clicking; check if already expanded to avoid toggle-close.
  let trigger = screen.getByTestId('export-format-select')

  if (trigger.getAttribute('aria-expanded') !== 'true') {
    await user.click(trigger)
  }

  // After user.click, React has processed the click handler synchronously (state: open=true).
  // Wrap in act() to flush all pending state updates and layout effects, ensuring the portal
  // <ul> is committed to document.body before we access it. This avoids the race where
  // aria-expanded becomes 'true' but the portal hasn't been committed yet under CPU load.
  await act(async () => {})

  // Re-query after act() in case the component re-mounted
  trigger = screen.getByTestId('export-format-select')

  if (trigger.getAttribute('aria-expanded') !== 'true') {
    // Retry once if the dropdown didn't open (very rare under extreme CPU pressure)
    await user.click(trigger)
    await act(async () => {})
    trigger = screen.getByTestId('export-format-select')
  }

  // Use aria-controls to get the listbox ID and retrieve the element directly.
  // getElementById is O(1) and avoids findByRole's setInterval polling which can race
  // under parallel load.
  const listboxId = trigger.getAttribute('aria-controls')
  if (!listboxId) {
    throw new Error('Export format trigger has no aria-controls attribute')
  }

  const listbox = document.getElementById(listboxId)
  if (!listbox) {
    // Fallback to findByRole in case of portal timing edge case
    return await screen.findByRole('listbox', undefined, { timeout: 3_000 })
  }

  return listbox
}

/** jsdom + focus trap: keyboard typing into the destination field is unreliable; drive controlled input directly. */
function setExportDestinationPath(path: string) {
  const input = screen.getByTestId('export-file-path-input')
  fireEvent.change(input, { target: { value: path } })
}

describe('ExportDialog', () => {
  const defaultProps = {
    connectionId: 'conn-1',
    tabId: 'tab-1',
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

    const combo = screen.getByTestId('export-format-select')
    await pickExportFormat(user, 'json')
    expect(combo).toHaveTextContent('JSON')

    await pickExportFormat(user, 'xlsx')
    expect(combo).toHaveTextContent('Excel')

    await pickExportFormat(user, 'sql-insert')
    expect(combo).toHaveTextContent('SQL INSERT')
  })

  it('export button is disabled when no file path', () => {
    render(<ExportDialog {...defaultProps} />)
    const exportBtn = screen.getByTestId('export-submit-button')
    expect(exportBtn).toBeDisabled()
  })

  it('export button is enabled when file path is provided', () => {
    render(<ExportDialog {...defaultProps} />)

    setExportDestinationPath('/tmp/export.csv')

    const exportBtn = screen.getByTestId('export-submit-button')
    expect(exportBtn).not.toBeDisabled()
  })

  it('export button calls exportResults IPC with correct options', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExportDialog {...defaultProps} onClose={onClose} />)

    setExportDestinationPath('/tmp/export.csv')

    // Click Export
    const exportBtn = screen.getByTestId('export-submit-button')
    await user.click(exportBtn)

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          {
            format: 'csv',
            filePath: '/tmp/export.csv',
            includeHeaders: true,
            tableName: undefined,
          },
          undefined,
          undefined
        )
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
    await pickExportFormat(user, 'sql-insert')

    setExportDestinationPath('/tmp/export.sql')

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
          }),
          undefined,
          undefined
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

    setExportDestinationPath('/tmp/export.csv')
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

    setExportDestinationPath('/tmp/export.csv')
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

  it('does not display estimated size footer content', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.queryByTestId('export-estimated-size')).not.toBeInTheDocument()
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
    await pickExportFormat(user, 'sql-insert')

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
    setExportDestinationPath('/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({
            includeHeaders: false,
          }),
          undefined,
          undefined
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

    setExportDestinationPath('/tmp/export.csv')
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

    const listbox = await openExportFormatListbox(user)
    fireEvent.click(
      within(listbox).getByRole('option', { name: EXPORT_FORMAT_LABELS['sql-insert'] })
    )

    await waitFor(() => {
      expect(screen.getByTestId('export-table-name-input')).toHaveValue('users')
    })
  })

  it('renders without removed sizing props', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
  })

  it('shows error message for non-Error thrown value', async () => {
    mockExportResults.mockRejectedValue('string error')
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    setExportDestinationPath('/tmp/export.csv')
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

    setExportDestinationPath('/tmp/export.csv')
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

    await pickExportFormat(user, 'sql-insert')
    const tableNameInput = screen.getByTestId('export-table-name-input')
    await user.clear(tableNameInput)
    await user.type(tableNameInput, 'my_table')

    setExportDestinationPath('/tmp/export.sql')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({
            format: 'sql-insert',
            tableName: 'my_table',
          }),
          undefined,
          undefined
        )
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('shows format description for each format option', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    const listbox = await openExportFormatListbox(user)
    expect(listbox).toHaveTextContent('Comma Separated Values')
    expect(listbox).toHaveTextContent('JSON Array of Objects')
    expect(listbox).toHaveTextContent('Excel Spreadsheet (.xlsx)')
    expect(listbox).toHaveTextContent('SQL INSERT Statements')

    for (const description of EXPORT_FORMAT_DESCRIPTIONS) {
      expect(listbox).toHaveTextContent(description)
    }

    for (const label of Object.values(EXPORT_FORMAT_LABELS)) {
      expect(screen.getByRole('option', { name: label })).toBeVisible()
    }
  })

  it('destination prefix changes based on selected format', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    // Default is CSV — the destination prefix shows .csv
    const dialog = screen.getByTestId('export-dialog')
    expect(dialog.textContent).toContain('.csv')

    // Switch to JSON
    await pickExportFormat(user, 'json')
    expect(dialog.textContent).toContain('.json')
  })

  it('hides SQL INSERT format option when isView=true', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} isView={true} />)

    const listbox = await openExportFormatListbox(user)
    expect(listbox).toHaveTextContent('Comma Separated Values')
    expect(listbox).toHaveTextContent('JSON Array of Objects')
    expect(listbox).toHaveTextContent('Excel Spreadsheet (.xlsx)')
    expect(listbox).not.toHaveTextContent('SQL INSERT Statements')
  })

  it('resets format to csv if isView=true and format was sql-insert', async () => {
    const user = userEvent.setup()
    // First render without isView — select SQL INSERT
    const { rerender } = render(<ExportDialog {...defaultProps} />)

    await pickExportFormat(user, 'sql-insert')
    const combo = screen.getByTestId('export-format-select')
    expect(combo).toHaveTextContent('SQL INSERT')

    // Re-render with isView=true — format should reset to CSV
    rerender(<ExportDialog {...defaultProps} isView={true} />)

    await waitFor(() => {
      expect(combo).toHaveTextContent('CSV')
    })
  })

  it('passes rowIndices to exportResults when provided', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const rowIndices = [0, 2, 5]
    render(<ExportDialog {...defaultProps} onClose={onClose} rowIndices={rowIndices} />)

    setExportDestinationPath('/tmp/filtered-export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({
            format: 'csv',
            filePath: '/tmp/filtered-export.csv',
          }),
          undefined,
          [0, 2, 5]
        )
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('does not pass rowIndices to exportResults when not provided', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    setExportDestinationPath('/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        expect(mockExportResults).toHaveBeenCalledWith(
          'conn-1',
          'tab-1',
          expect.objectContaining({ format: 'csv' }),
          undefined,
          undefined
        )
      },
      { timeout: 5000 }
    )
  }, 15000)
})
