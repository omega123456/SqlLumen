import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { DEFAULT_RESULT_STATE, useQueryStore } from '../../../stores/query-store'
import * as ResultToolbarModule from '../../../components/query-editor/ResultToolbar'
import * as ResultGridViewModule from '../../../components/query-editor/ResultGridView'
import * as ResultFormViewModule from '../../../components/query-editor/ResultFormView'
import * as ResultTextViewModule from '../../../components/query-editor/ResultTextView'
import * as FilterDialogModule from '../../../components/dialogs/FilterDialog'

// Use vi.spyOn to install per-test mock implementations without vi.mock().

beforeEach(() => {
  vi.spyOn(ResultToolbarModule, 'ResultToolbar').mockImplementation(
    ({ tabId }: { tabId: string }) =>
      (<div data-testid="result-toolbar">{tabId}</div>) as unknown as React.ReactElement
  )
  vi.spyOn(ResultGridViewModule, 'ResultGridView').mockImplementation(
    ({ viewRowCount }: { viewRowCount: number }) =>
      (
        <div data-testid="grid-view">Grid rows: {viewRowCount}</div>
      ) as unknown as React.ReactElement
  )
  vi.spyOn(ResultFormViewModule, 'ResultFormView').mockImplementation(
    ({ viewRowCount }: { viewRowCount: number }) =>
      (
        <div data-testid="form-view">Form rows: {viewRowCount}</div>
      ) as unknown as React.ReactElement
  )
  vi.spyOn(ResultTextViewModule, 'ResultTextView').mockImplementation(
    ({ viewRowCount }: { viewRowCount: number }) =>
      (
        <div data-testid="text-view">Text rows: {viewRowCount}</div>
      ) as unknown as React.ReactElement
  )
  vi.spyOn(FilterDialogModule, 'FilterDialog').mockImplementation(
    () => null as unknown as React.ReactElement
  )
})

import React from 'react'

const result = {
  ...DEFAULT_RESULT_STATE,
  resultStatus: 'success' as const,
  columns: [{ name: 'id', dataType: 'INT' }],
  totalRows: 2,
  viewRowCount: 2,
}

describe('ResultPanel', () => {
  beforeEach(() => {
    act(() => {
      useQueryStore.setState({
        tabs: {
          tab1: {
            content: '',
            selectedText: '',
            filePath: null,
            tabStatus: 'success',
            prevTabStatus: 'idle',
            cursorPosition: null,
            connectionId: 'c1',
            results: [result],
            activeResultIndex: 0,
            pendingNavigationAction: null,
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
            activeBottomPanelItem: { type: 'result' },
          },
        },
      })
    })
  })

  it('renders the grid result view and row count', () => {
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('grid-view')).toHaveTextContent('Grid rows: 2')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'result-tabpanel-tab1-0')
  })

  it('switching view mode changes the rendered view', async () => {
    const user = userEvent.setup()
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    act(() => useQueryStore.getState().setViewMode('tab1', 'form'))
    expect(await screen.findByTestId('form-view')).toHaveTextContent('Form rows: 2')
    act(() => useQueryStore.getState().setViewMode('tab1', 'text'))
    await user.click(document.body)
    expect(await screen.findByTestId('text-view')).toHaveTextContent('Text rows: 2')
  })

  it('handles empty successful results', () => {
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          tab1: {
            ...state.tabs.tab1,
            results: [{ ...result, columns: [], affectedRows: 0 }],
          },
        },
      }))
    })
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    const success = screen.getByTestId('dml-success')
    expect(success).toHaveTextContent('Query executed successfully')
    expect(success).toHaveAttribute('data-severity', 'success')
    expect(success).toHaveAttribute('role', 'status')
  })

  it('shows query errors in an error InfoBar with a glyph', () => {
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          tab1: {
            ...state.tabs.tab1,
            tabStatus: 'error',
            results: [
              {
                ...result,
                resultStatus: 'error' as const,
                columns: [],
                errorMessage: "Table 'shop.user' doesn't exist",
              },
            ],
          },
        },
      }))
    })
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    const error = screen.getByTestId('result-error')
    expect(error).toHaveAttribute('data-severity', 'error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent('Query failed')
    expect(error).toHaveTextContent("Table 'shop.user' doesn't exist")
    expect(error.querySelector('[aria-hidden="true"]')).toHaveTextContent('✕')
  })

  it('renders idle empty state when no results exist', () => {
    act(() => useQueryStore.setState({ tabs: {} }))
    render(<ResultPanel tabId="missing" connectionId="c1" />)
    expect(screen.getByText('Run a query to see results')).toBeInTheDocument()
  })

  it('does not create a result tabpanel when embedded under the combined strip', () => {
    render(<ResultPanel tabId="tab1" connectionId="c1" hideSubTabs />)

    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('grid-view')).toHaveTextContent('Grid rows: 2')
  })

  describe('band slot (wireframes 1, 1b and 2)', () => {
    function setResult(patch: Record<string, unknown>, tabPatch: Record<string, unknown> = {}) {
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            tab1: {
              ...state.tabs.tab1,
              ...tabPatch,
              results: [{ ...result, queryId: 'q-1', ...patch }],
            },
          },
        }))
      })
    }

    it('shows no band for an untruncated result without failures', () => {
      render(<ResultPanel tabId="tab1" connectionId="c1" />)
      expect(screen.queryByTestId('result-band-slot')).not.toBeInTheDocument()
    })

    it('announces a truncated re-runnable result politely with "Export all rows…"', async () => {
      const user = userEvent.setup()
      setResult({ truncated: true, rowCeiling: 100000, totalRows: 100000, viewRowCount: 100000 })
      render(<ResultPanel tabId="tab1" connectionId="c1" />)

      const band = screen.getByTestId('result-truncation-band')
      expect(band).toHaveAttribute('role', 'status')
      expect(band).toHaveAttribute('aria-live', 'polite')
      expect(band).toHaveAttribute('data-severity', 'warning')
      expect(band).toHaveTextContent('Showing the first 100,000 rows')
      expect(band).toHaveTextContent(
        'Result truncated. This query returned more rows than the maximum rows kept per result.'
      )
      expect(band.querySelector('[aria-label="Close"], [data-testid*="dismiss"]')).toBeNull()

      await user.click(screen.getByTestId('truncation-export-all'))
      const after = useQueryStore.getState().tabs.tab1!.results[0]
      expect(after.exportDialogOpen).toBe(true)
      expect(after.preferredExportScope).toBe('allRows')
    })

    it.each([
      [
        'call',
        'Result truncated. Exporting all rows would run this stored procedure again and repeat its changes. To keep more rows in future runs, raise Maximum rows kept per result in Settings.',
      ],
      [
        'locking',
        'Result truncated. Exporting all rows would run this locking query again and take its locks again. To export every row, remove the locking clause and run the query again.',
      ],
      [
        'unknownDatabase',
        "Result truncated. The database this query ran in couldn't be recorded, so all rows can't be exported. Run the query again to enable full export.",
      ],
    ])('explains why a truncated %s result has no full export (wireframe 1b)', (reason, copy) => {
      setResult({
        truncated: true,
        rowCeiling: 100000,
        totalRows: 100000,
        viewRowCount: 100000,
        fullExportBlockedReason: reason,
      })
      render(<ResultPanel tabId="tab1" connectionId="c1" />)
      const band = screen.getByTestId('result-truncation-band')
      expect(band).toHaveAttribute('role', 'status')
      expect(band).toHaveTextContent('Showing the first 100,000 rows')
      expect(band).toHaveTextContent(copy)
      expect(screen.queryByTestId('truncation-export-all')).not.toBeInTheDocument()
    })

    it('shows the window failure band below the truncation band, and Retry refetches', async () => {
      const user = userEvent.setup()
      setResult({
        truncated: true,
        rowCeiling: 100000,
        totalRows: 100000,
        viewRowCount: 100000,
        failedWindowRange: [12000, 13000],
      })
      const retry = vi.spyOn(useQueryStore.getState(), 'retryResultWindow')
      render(<ResultPanel tabId="tab1" connectionId="c1" />)

      const slot = screen.getByTestId('result-band-slot')
      const bands = Array.from(slot.children).map((child) => child.getAttribute('data-testid'))
      expect(bands).toEqual(['result-truncation-band', 'result-window-error-band'])
      const failure = screen.getByTestId('result-window-error-band')
      expect(failure).toHaveAttribute('data-severity', 'error')
      expect(failure).toHaveTextContent("Couldn't load rows 12,001–13,000")
      expect(failure).toHaveTextContent('Retry to load these rows.')
      await user.click(screen.getByTestId('window-error-retry'))
      expect(retry).toHaveBeenCalledWith('tab1')
    })

    it('shows the view-change failure band with the backend message and Retry', async () => {
      const user = userEvent.setup()
      setResult({ viewError: "Sort column 'x' not found" })
      const retry = vi.spyOn(useQueryStore.getState(), 'retryViewChange')
      render(<ResultPanel tabId="tab1" connectionId="c1" />)
      const band = screen.getByTestId('result-view-error-band')
      expect(band).toHaveTextContent("Couldn't apply sort or filter")
      expect(band).toHaveTextContent("Sort column 'x' not found")
      await user.click(screen.getByTestId('view-error-retry'))
      expect(retry).toHaveBeenCalledWith('tab1')
    })

    it('routes an expired result to the Results expired block instead of a band', () => {
      setResult({ isExpired: true, failedWindowRange: [0, 500] })
      render(<ResultPanel tabId="tab1" connectionId="c1" />)
      expect(screen.getByText('Results expired')).toBeInTheDocument()
      expect(screen.queryByTestId('result-window-error-band')).not.toBeInTheDocument()
    })
  })
})
