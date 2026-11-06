import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExportDialog from '../../../components/dialogs/ExportDialog'
import {
  useQueryStore,
  DEFAULT_RESULT_STATE,
  type SingleResultState,
} from '../../../stores/query-store'
import { useToastStore } from '../../../stores/toast-store'
import { ipc, expectToast } from '../../ipc-mock'
import { makeTabState } from '../../helpers/query-test-utils'

beforeEach(() => {
  // Default: export_results returns success; plugin:dialog|save returns a path
  ipc.override('export_results', () => ({ bytesWritten: 1024, rowsExported: 5 }))
  ipc.override('plugin:dialog|save', () => '/mock/path/export.csv')
  useQueryStore.setState({ tabs: {} })
})

const EXPORT_FORMAT_REGEX: Record<'csv' | 'json' | 'xlsx' | 'sql-insert', RegExp> = {
  csv: /CSV \(Comma Separated Values\)/,
  json: /JSON \(JavaScript Object Notation\)/,
  xlsx: /Excel \(\.xlsx\)/,
  'sql-insert': /SQL INSERT statements/,
}

const EXPORT_FORMAT_LABELS = {
  csv: 'CSV (Comma Separated Values)',
  json: 'JSON (JavaScript Object Notation)',
  xlsx: 'Excel (.xlsx)',
  'sql-insert': 'SQL INSERT statements',
} as const

const EXPORT_FORMAT_DESCRIPTIONS = [
  'Comma Separated Values',
  'JSON array of objects',
  'Excel Spreadsheet (.xlsx)',
  'SQL INSERT statements',
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
    expect(screen.getByRole('heading', { name: /Export results/ })).toBeInTheDocument()
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
        const calls = ipc.calls('export_results')
        expect(calls).toHaveLength(1)
        const args = calls[0] as Record<string, unknown>
        expect(args).toMatchObject({
          connectionId: 'conn-1',
          tabId: 'tab-1',
          options: {
            format: 'csv',
            filePath: '/tmp/export.csv',
            includeHeaders: true,
          },
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

  it('submits when the dialog form is submitted from the destination field flow', async () => {
    render(<ExportDialog {...defaultProps} />)

    setExportDestinationPath('/tmp/export.csv')
    fireEvent.submit(screen.getByTestId('export-dialog-panel'))

    await waitFor(() => {
      const calls = ipc.calls('export_results')
      expect(calls).toHaveLength(1)
      const args = calls[0] as Record<string, unknown>
      const options = args.options as Record<string, unknown>
      expect(options.filePath).toBe('/tmp/export.csv')
    })
  })

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
        const calls = ipc.calls('export_results')
        expect(calls).toHaveLength(1)
        const args = calls[0] as Record<string, unknown>
        const options = args.options as Record<string, unknown>
        expect(options).toMatchObject({
          format: 'sql-insert',
          tableName: 'exported_results',
        })
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
    ipc.override('export_results', () => {
      throw new Error('Export failed: disk full')
    })
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

  it('marks the targeted result expired when export returns results_expired', async () => {
    ipc.override('export_results', () => {
      throw new Error('results_expired: Cached results are no longer available.')
    })
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          content: 'SELECT 1; SELECT 2;',
          selectedText: '',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-1',
              lastExecutedSql: 'SELECT 1',
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-2',
              lastExecutedSql: 'SELECT 2',
            },
          ],
          activeResultIndex: 0,
          activeBottomPanelItem: { type: 'result' },
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} resultIndex={1} />)

    setExportDestinationPath('/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(() => {
      expect(useQueryStore.getState().tabs['tab-1']?.results[0]?.isExpired).toBe(false)
      expect(useQueryStore.getState().tabs['tab-1']?.results[1]?.isExpired).toBe(true)
    })
  })

  it('export button is disabled during export (loading state)', async () => {
    // Make export_results hang indefinitely
    ipc.override('export_results', () => new Promise(() => {}))
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
        const calls = ipc.calls('export_results')
        expect(calls).toHaveLength(1)
        const args = calls[0] as Record<string, unknown>
        const options = args.options as Record<string, unknown>
        expect(options).toMatchObject({ includeHeaders: false })
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
    expect(ipc.calls('export_results')).toHaveLength(0)
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
    ipc.override('export_results', () => {
      throw 'string error'
    })
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

    expect(ipc.calls('export_results')).toHaveLength(0)
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
        const calls = ipc.calls('export_results')
        expect(calls).toHaveLength(1)
        const options = (calls[0] as Record<string, unknown>).options as Record<string, unknown>
        expect(options).toMatchObject({
          format: 'sql-insert',
          tableName: 'my_table',
        })
      },
      { timeout: 5000 }
    )
  }, 15000)

  it('shows format description for each format option', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    const listbox = await openExportFormatListbox(user)
    expect(listbox).toHaveTextContent('Comma Separated Values')
    expect(listbox).toHaveTextContent('JSON array of objects')
    expect(listbox).toHaveTextContent('Excel Spreadsheet (.xlsx)')
    expect(listbox).toHaveTextContent('SQL INSERT statements')

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
    expect(listbox).toHaveTextContent('JSON array of objects')
    expect(listbox).toHaveTextContent('Excel Spreadsheet (.xlsx)')
    expect(listbox).not.toHaveTextContent('SQL INSERT statements')
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

  it('never passes rowIndices: the backend exports the current view', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)

    setExportDestinationPath('/tmp/export.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    await waitFor(
      () => {
        const calls = ipc.calls('export_results')
        expect(calls).toHaveLength(1)
        const args = calls[0] as Record<string, unknown>
        expect(args.options).toMatchObject({ format: 'csv' })
        expect('rowIndices' in args).toBe(false)
      },
      { timeout: 5000 }
    )
  }, 15000)
})

// ---------------------------------------------------------------------------
// Phase 2: "All rows" streaming full export for truncated results (wireframe 6)
// ---------------------------------------------------------------------------

describe('ExportDialog — full export of truncated results', () => {
  const TAB = 'tab-1'
  const CONN = 'conn-1'

  type Progress = {
    status: 'running' | 'completed' | 'cancelled' | 'failed'
    rowsWritten: number
    bytesWritten: number
    elapsedMs: number
    stoppedAtSheetLimit: boolean
    error: string | null
  }
  let progress: Progress
  const running = (rowsWritten: number, bytesWritten = 0, elapsedMs = 0): Progress => ({
    status: 'running',
    rowsWritten,
    bytesWritten,
    elapsedMs,
    stoppedAtSheetLimit: false,
    error: null,
  })

  function seedResult(overrides: Partial<SingleResultState> = {}) {
    useQueryStore.setState({
      exportJobs: {},
      tabs: {
        [TAB]: {
          ...makeTabState({ connectionId: CONN, tabStatus: 'success' }),
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-truncated',
              truncated: true,
              rowCeiling: 100_000,
              totalRows: 100_000,
              viewRowCount: 2_340,
              exportDialogOpen: true,
              ...overrides,
            },
          ],
        },
      },
    })
  }

  /** Renders the dialog while the store says it is open, as ResultPanel does. */
  function Harness() {
    const open = useQueryStore((s) => s.tabs[TAB]?.results[0]?.exportDialogOpen ?? false)
    if (!open) return null
    return (
      <ExportDialog
        connectionId={CONN}
        tabId={TAB}
        resultIndex={0}
        onClose={() => useQueryStore.getState().closeExportDialog(TAB)}
      />
    )
  }

  async function openListbox(user: ReturnType<typeof userEvent.setup>, testId: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (screen.getByTestId(testId).getAttribute('aria-expanded') !== 'true') {
        await user.click(screen.getByTestId(testId))
      }
      await act(async () => {})
      const listboxId = screen.getByTestId(testId).getAttribute('aria-controls')
      const listbox = listboxId ? document.getElementById(listboxId) : null
      if (listbox) return listbox
    }
    return await screen.findByRole('listbox')
  }

  async function pick(user: ReturnType<typeof userEvent.setup>, testId: string, name: RegExp) {
    const listbox = await openListbox(user, testId)
    fireEvent.click(within(listbox).getByRole('option', { name }))
  }

  async function startAllRowsExport(user: ReturnType<typeof userEvent.setup>) {
    setExportDestinationPath('/tmp/all.csv')
    await user.click(screen.getByTestId('export-submit-button'))
    await screen.findByTestId('export-progress')
  }

  beforeEach(() => {
    progress = running(0)
    ipc.override('start_result_export', () => 'job-1')
    ipc.override('get_result_export_progress', () => progress)
    ipc.override('cancel_result_export', () => null)
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    // Stop any polling left running.
    act(() => {
      useQueryStore.getState().cleanupConnection(CONN, [TAB])
    })
  })

  it('shows the unchanged dialog for untruncated results', async () => {
    const user = userEvent.setup()
    seedResult({ truncated: false })
    render(<Harness />)
    expect(screen.queryByTestId('export-rows-select')).not.toBeInTheDocument()
    const listbox = await openListbox(user, 'export-format-select')
    expect(listbox).toHaveTextContent('Excel Spreadsheet (.xlsx)')
    expect(listbox).not.toHaveTextContent('up to 1,048,576 rows')
  })

  it.each(['call', 'locking', 'unknownDatabase'] as const)(
    'offers no Rows choice for a truncated %s result',
    (reason) => {
      seedResult({ fullExportBlockedReason: reason, preferredExportScope: 'allRows' })
      render(<Harness />)
      expect(screen.queryByTestId('export-rows-select')).not.toBeInTheDocument()
      expect(screen.queryByTestId('export-sheet-limit-warning')).not.toBeInTheDocument()
    }
  )

  it('offers the Rows choice with descriptions, defaulting to the current view', async () => {
    const user = userEvent.setup()
    seedResult()
    render(<Harness />)

    const rows = screen.getByTestId('export-rows-select')
    expect(rows).toHaveTextContent('Current view · 2,340 rows')
    const listbox = await openListbox(user, 'export-rows-select')
    expect(listbox).toHaveTextContent(
      'Rows in memory, with the current sort and filter. No re-run.'
    )
    expect(listbox).toHaveTextContent(
      'Streams every row to file. Sort and filter are not applied. Not limited by the row ceiling.'
    )
    fireEvent.click(within(listbox).getByRole('option', { name: /All rows · re-runs the query/ }))
    expect(screen.getByTestId('export-rows-select')).toHaveTextContent(
      'All rows · re-runs the query'
    )

    const formats = await openListbox(user, 'export-format-select')
    expect(formats).toHaveTextContent('Excel (.xlsx) · up to 1,048,576 rows')
  })

  it('preselects All rows when opened from "Export all rows…"', () => {
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    expect(screen.getByTestId('export-rows-select')).toHaveTextContent(
      'All rows · re-runs the query'
    )
  })

  it('warns that sort and filters are ignored, and "Use current view" switches back', async () => {
    const user = userEvent.setup()
    seedResult({
      preferredExportScope: 'allRows',
      filterModel: [
        { column: 'a', operator: '==', value: '1' },
        { column: 'b', operator: '!=', value: '2' },
      ],
    })
    render(<Harness />)

    const warning = screen.getByTestId('export-ignored-view-warning')
    expect(warning).toHaveTextContent("Sort and filter aren't applied to all rows.")
    expect(warning).toHaveTextContent('Your 2 filters will be ignored.')
    expect(warning).toHaveAttribute('role', 'status')

    await user.click(screen.getByTestId('export-use-current-view'))
    expect(screen.queryByTestId('export-ignored-view-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('export-rows-select')).toHaveTextContent('Current view · 2,340 rows')
  })

  it.each([
    [{ sortColumn: 'a', sortDirection: 'asc' as const }, 'Your sort will be ignored.'],
    [
      {
        sortColumn: 'a',
        sortDirection: 'desc' as const,
        filterModel: [{ column: 'a', operator: '==' as const, value: '1' }],
      },
      'Your sort and 1 filter will be ignored.',
    ],
  ])('names the ignored sort (%#)', (overrides, message) => {
    seedResult({ preferredExportScope: 'allRows', ...overrides })
    render(<Harness />)
    expect(screen.getByTestId('export-ignored-view-warning')).toHaveTextContent(message)
  })

  it('warns about the Excel sheet limit, and "Switch to CSV" changes the format', async () => {
    const user = userEvent.setup()
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    expect(screen.queryByTestId('export-sheet-limit-warning')).not.toBeInTheDocument()

    await pick(user, 'export-format-select', /Excel \(\.xlsx\)/)
    expect(screen.getByTestId('export-sheet-limit-warning')).toHaveTextContent(
      'Excel sheets stop at 1,048,576 rows. Rows past that are not written.'
    )

    await user.click(screen.getByTestId('export-switch-to-csv'))
    expect(screen.getByTestId('export-format-select')).toHaveTextContent('CSV')
    expect(screen.queryByTestId('export-sheet-limit-warning')).not.toBeInTheDocument()
  })

  it('renders the Close and Browse buttons with icons and accessible names', () => {
    seedResult()
    render(<Harness />)
    const close = screen.getByRole('button', { name: 'Close' })
    const browse = screen.getByRole('button', { name: 'Browse' })
    for (const button of [close, browse]) {
      const icon = button.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('a current-view export of a truncated result still uses the cached export', async () => {
    const user = userEvent.setup()
    seedResult()
    render(<Harness />)
    setExportDestinationPath('/tmp/view.csv')
    await user.click(screen.getByTestId('export-submit-button'))
    await waitFor(() => expect(ipc.calls('export_results')).toHaveLength(1))
    expect(ipc.calls('start_result_export')).toHaveLength(0)
  })

  it('streams all rows with progress, cannot be dismissed, and cancels', async () => {
    const user = userEvent.setup()
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    progress = running(1_240_000, 318 * 1024 * 1024, 42_000)

    await startAllRowsExport(user)
    expect(ipc.calls('start_result_export')[0]).toMatchObject({
      tabId: TAB,
      queryId: 'q-truncated',
      format: 'csv',
      filePath: '/tmp/all.csv',
    })
    expect(ipc.calls('export_results')).toHaveLength(0)
    expect(screen.getByText('Exporting all rows…')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('export-progress-stats')).toHaveTextContent(
        'Rows written 1,240,000 · 318 MB · 0:42'
      )
    )

    // Non-dismissible: no close button, Escape does nothing.
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('export-progress')).toBeInTheDocument()

    const cancel = screen.getByTestId('export-cancel-full-button')
    expect(cancel).toHaveTextContent('Cancel export')
    await user.click(cancel)
    expect(screen.getByTestId('export-cancel-full-button')).toHaveTextContent('Cancelling…')
    expect(screen.getByTestId('export-cancel-full-button')).toBeDisabled()
    expect(ipc.calls('cancel_result_export')).toEqual([{ jobId: 'job-1' }])

    progress = { ...running(1_240_100), status: 'cancelled' }
    const bar = await screen.findByTestId('export-cancelled', {}, { timeout: 1_500 })
    expect(bar).toHaveTextContent('Export cancelled')
    expect(bar).toHaveTextContent('No file was written.')
  })

  it('shows "Building workbook…" for XLSX until rows flow, then rows and time without MB', async () => {
    const user = userEvent.setup()
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    await pick(user, 'export-format-select', /Excel \(\.xlsx\)/)
    await startAllRowsExport(user)
    await waitFor(() => expect(ipc.calls('get_result_export_progress').length).toBeGreaterThan(0))
    expect(screen.getByTestId('export-progress-stats')).toHaveTextContent('Building workbook…')

    // XLSX reports 0 bytes until the workbook is saved, so the MB segment is hidden.
    progress = running(1_500, 0, 65_000)
    await waitFor(
      () =>
        expect(screen.getByTestId('export-progress-stats')).toHaveTextContent(
          /^Rows written 1,500 · 1:05$/
        ),
      { timeout: 1_500 }
    )
    expect(screen.getByTestId('export-progress-stats')).not.toHaveTextContent('MB')
  })

  it('completion closes the dialog and shows the success toast', async () => {
    const user = userEvent.setup()
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    progress = running(10, 2048, 1_000)
    await startAllRowsExport(user)
    await waitFor(() =>
      expect(screen.getByTestId('export-progress-stats')).toHaveTextContent(
        'Rows written 10 · 0.0 MB · 0:01'
      )
    )

    progress = { ...running(250_000), status: 'completed' }
    await waitFor(() => expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument(), {
      timeout: 1_500,
    })
    await expectToast('success', 'Export completed')
    await expectToast('success', '250,000 rows saved to /tmp/all.csv')
  })

  it('a failure shows the error bar, moves focus to it, toasts, and Try again restarts', async () => {
    const user = userEvent.setup()
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    progress = { ...running(3), status: 'failed', error: 'Query failed: Deadlock found' }
    setExportDestinationPath('/tmp/all.csv')
    await user.click(screen.getByTestId('export-submit-button'))

    const bar = await screen.findByTestId('export-failed')
    expect(bar).toHaveTextContent('Export failed')
    expect(bar).toHaveTextContent('Query failed: Deadlock found')
    expect(bar).toHaveTextContent('No file was written.')
    await waitFor(() => expect(bar).toHaveFocus())
    await expectToast('error', 'Export failed')

    progress = running(1)
    await user.click(screen.getByTestId('export-try-again'))
    await screen.findByTestId('export-progress')
    expect(ipc.calls('start_result_export')).toHaveLength(2)
    expect(ipc.calls('start_result_export')[1]).toMatchObject({ filePath: '/tmp/all.csv' })
  })

  it('closing on a tab switch keeps the export running, and reopening shows its progress', async () => {
    const user = userEvent.setup()
    seedResult({ preferredExportScope: 'allRows' })
    render(<Harness />)
    progress = running(5, 10, 0)
    await startAllRowsExport(user)

    // ResultPanel closes the dialog when its tab goes inactive.
    act(() => {
      useQueryStore.getState().closeExportDialog(TAB)
    })
    expect(screen.queryByTestId('export-dialog')).not.toBeInTheDocument()
    expect(ipc.calls('cancel_result_export')).toHaveLength(0)
    const polls = ipc.calls('get_result_export_progress').length
    await waitFor(
      () => expect(ipc.calls('get_result_export_progress').length).toBeGreaterThan(polls),
      { timeout: 1_500 }
    )

    act(() => {
      useQueryStore.getState().openExportDialog(TAB, 'allRows')
    })
    expect(await screen.findByTestId('export-progress')).toBeInTheDocument()
    expect(screen.getByTestId('export-progress-stats')).toHaveTextContent('Rows written 5')
  })
})
