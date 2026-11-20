import { resultWith } from '../../helpers/query-store-fixtures'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, type ResultPatch, type TabQueryState } from '../../../stores/query-store'
import * as DataToolbarModule from '../../../components/shared/data-view/DataToolbar'
import type { DataViewSource } from '../../../components/shared/data-view/data-view-source'
import * as DataGridViewModule from '../../../components/shared/data-view/DataGridView'
import * as DataFormViewModule from '../../../components/shared/data-view/DataFormView'
import * as DataTextViewModule from '../../../components/shared/data-view/DataTextView'
import * as FilterDialogModule from '../../../components/dialogs/FilterDialog'
import React from 'react'
import { expectToast, ipc } from '../../ipc-mock'
import { withRows } from '../../helpers/query-test-utils'
import { seedResultWindow } from '../../../lib/result-window-cache'
import type { FullExportBlockedReason } from '../../../types/schema'

// Use vi.spyOn to install per-test mock implementations without vi.mock().

const result = resultWith({
  resultStatus: 'success' as const,
  view: { slot: { columns: [{ name: 'id', dataType: 'INT' }], totalRows: 2, viewRowCount: 2 } },
})

describe('ResultPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.spyOn(DataToolbarModule, 'DataToolbar').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="result-toolbar">{source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
    vi.spyOn(DataGridViewModule.DataGridView, 'type').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="grid-view">Grid surface: {source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
    vi.spyOn(DataFormViewModule, 'DataFormView').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="form-view">Form surface: {source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
    vi.spyOn(DataTextViewModule, 'DataTextView').mockImplementation(
      ({ source }: { source: DataViewSource }) =>
        (
          <div data-testid="text-view">Text surface: {source.ref.tabId}</div>
        ) as unknown as React.ReactElement
    )
    vi.spyOn(FilterDialogModule, 'FilterDialog').mockImplementation(
      () => null as unknown as React.ReactElement
    )

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
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
            runExport: null,
            activeBottomPanelItem: { type: 'result' },
          },
        },
      })
    })
  })

  it('renders the grid result view and row count', () => {
    render(<ResultPanel tabId="tab1" connectionId="c1" />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('grid-view')).toHaveTextContent('Grid surface: tab1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'result-tabpanel-tab1-0')
  })

  it('handles empty successful results', () => {
    act(() => {
      useQueryStore.setState((state) => ({
        tabs: {
          ...state.tabs,
          tab1: {
            ...state.tabs.tab1,
            results: [
              resultWith(
                {
                  view: { slot: { columns: [] } },
                  affectedRows: 0,
                },
                result
              ),
            ],
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
              resultWith(
                {
                  resultStatus: 'error' as const,
                  view: { slot: { columns: [] } },
                  errorMessage: "Table 'shop.user' doesn't exist",
                },
                result
              ),
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
    expect(screen.getByTestId('grid-view')).toHaveTextContent('Grid surface: tab1')
  })

  describe('band slot (wireframes 1, 1b and 2)', () => {
    function setResult(patch: ResultPatch, tabPatch: Partial<TabQueryState> = {}) {
      act(() => {
        useQueryStore.setState((state) => ({
          tabs: {
            ...state.tabs,
            tab1: {
              ...state.tabs.tab1,
              ...tabPatch,
              results: [
                resultWith(patch, resultWith({ view: { slot: { queryId: 'q-1' } } }, result)),
              ],
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
      setResult({
        truncated: true,
        rowCeiling: 100000,
        view: { slot: { totalRows: 100000, viewRowCount: 100000 } },
      })
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
      expect(after.view.prompts.isExportOpen).toBe(true)
      expect(after.view.prompts.exportScope).toBe('allRows')
    })

    it('points a truncated result from a full run at the run file, which has every row', async () => {
      const user = userEvent.setup()
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      setResult(
        {
          truncated: true,
          rowCeiling: 100000,
          view: { slot: { totalRows: 100000, viewRowCount: 100000 } },
          exportedRowCount: 2345678,
        },
        {
          runExport: {
            runId: 'run-1',
            runFilePath: '/tmp/run.md',
            progress: null,
            isActive: false,
          },
        }
      )
      render(<ResultPanel tabId="tab1" connectionId="c1" />)

      const band = screen.getByTestId('result-truncation-band')
      expect(band).toHaveAttribute('aria-live', 'polite')
      expect(band).toHaveTextContent('Showing the first 100,000 of 2,345,678 rows')
      expect(band).toHaveTextContent(
        "The run file has every row, in query order. Sort and filter don't apply."
      )
      expect(screen.queryByTestId('truncation-export-all')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('truncation-copy-run-path'))
      await waitFor(() => expectToast('success', 'Run file path copied'))
    })

    it.each<[FullExportBlockedReason, string]>([
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
        view: { slot: { totalRows: 100000, viewRowCount: 100000 } },
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
        view: {
          slot: { totalRows: 100000, viewRowCount: 100000 },
          window: { failedRange: [12000, 13000] },
        },
      })
      seedResultWindow({
        route: 'query',
        connectionId: 'c1',
        tabId: 'tab1',
        resultIndex: 0,
        queryId: 'q-1',
        viewVersion: useQueryStore.getState().tabs.tab1!.results[0]!.view.slot.viewVersion,
        viewRowCount: 100000,
        columns: [],
        window: { offset: 0, rows: [], baseIndices: [] },
      })
      render(<ResultPanel tabId="tab1" connectionId="c1" />)

      const slot = screen.getByTestId('result-band-slot')
      const bands = Array.from(slot.children).map((child) => child.getAttribute('data-testid'))
      expect(bands).toEqual(['result-truncation-band', 'result-window-error-band'])
      const failure = screen.getByTestId('result-window-error-band')
      expect(failure).toHaveAttribute('data-severity', 'error')
      expect(failure).toHaveTextContent("Couldn't load rows 12,001–13,000")
      expect(failure).toHaveTextContent('Retry to load these rows.')
      await user.click(screen.getByTestId('window-error-retry'))
      await waitFor(() =>
        expect(screen.queryByTestId('result-window-error-band')).not.toBeInTheDocument()
      )
    })

    it('shows the view-change failure band with the backend message and Retry', async () => {
      const user = userEvent.setup()
      setResult({
        view: { spec: { error: "Sort column 'x' not found" } },
      })
      render(<ResultPanel tabId="tab1" connectionId="c1" />)
      const band = screen.getByTestId('result-view-error-band')
      expect(band).toHaveTextContent("Couldn't apply sort or filter")
      expect(band).toHaveTextContent("Sort column 'x' not found")
      await user.click(screen.getByTestId('view-error-retry'))
      await waitFor(() => expect(ipc.payloads('set_result_view')).toHaveLength(1))
    })

    it('routes an expired result to the Results expired block instead of a band', () => {
      setResult({
        view: { residency: { isExpired: true }, window: { failedRange: [0, 500] } },
      })
      render(<ResultPanel tabId="tab1" connectionId="c1" />)
      expect(screen.getByText('Results expired')).toBeInTheDocument()
      expect(screen.queryByTestId('result-window-error-band')).not.toBeInTheDocument()
    })
  })
})

describe('expired state', () => {
  const TAB_ID = 'test-tab-expired'
  const CONN_ID = 'conn-expired-1'

  function setTabWithExpiredResult() {
    act(() => {
      useQueryStore.setState({
        tabs: {
          [TAB_ID]: {
            content: 'SELECT * FROM users',
            selectedText: '',
            filePath: null,
            tabStatus: 'success',
            prevTabStatus: 'idle',
            cursorPosition: null,
            connectionId: CONN_ID,
            results: [
              resultWith({
                resultStatus: 'success',
                lastExecutedSql: 'SELECT * FROM users',
                ...withRows([[1]]),
                view: {
                  slot: {
                    queryId: 'q-expired-1',
                    columns: [{ name: 'id', dataType: 'INT' }],
                    totalRows: 1,
                  },
                  residency: { isExpired: true },
                },
              }),
            ],
            activeResultIndex: 0,
            activeBottomPanelItem: { type: 'result' },
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
            runExport: null,
          },
        },
      })
    })
  }

  function setTabWithRestoringRows() {
    act(() => {
      useQueryStore.setState({
        tabs: {
          [TAB_ID]: {
            content: 'SELECT * FROM users',
            selectedText: '',
            filePath: null,
            tabStatus: 'success',
            prevTabStatus: 'idle',
            cursorPosition: null,
            connectionId: CONN_ID,
            results: [
              resultWith({
                resultStatus: 'success',
                lastExecutedSql: 'SELECT * FROM users',
                ...withRows([]),
                view: {
                  slot: {
                    queryId: 'q-restoring-1',
                    columns: [{ name: 'id', dataType: 'INT' }],
                    totalRows: 1,
                  },
                  residency: {
                    rows: {
                      status: 'restoring',
                      isActive: true,
                      inactiveSince: null,
                    },
                  },
                },
              }),
            ],
            activeResultIndex: 0,
            activeBottomPanelItem: { type: 'result' },
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
            runExport: null,
          },
        },
      })
    })
  }

  describe('ResultPanel — expired state', () => {
    beforeEach(() => {
      useQueryStore.setState({ tabs: {} })
    })

    it('renders the expired banner when isExpired is true', () => {
      setTabWithExpiredResult()
      render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

      expect(screen.getByText('Results expired')).toBeInTheDocument()
      expect(screen.getByText('Cached results are no longer available.')).toBeInTheDocument()
      expect(screen.getByText('Re-run query')).toBeInTheDocument()
    })

    it('has a role="status" wrapper that is always present', () => {
      // Even when not expired, the wrapper is mounted
      act(() => {
        useQueryStore.setState({
          tabs: {
            [TAB_ID]: {
              content: '',
              selectedText: '',
              filePath: null,
              tabStatus: 'idle',
              prevTabStatus: 'idle',
              cursorPosition: null,
              connectionId: CONN_ID,
              results: [],
              activeResultIndex: 0,
              activeBottomPanelItem: { type: 'result' },
              executionStartedAt: null,
              isCancelling: false,
              wasCancelled: false,
              runExport: null,
            },
          },
        })
      })
      render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

      expect(screen.getByTestId('expired-status')).toBeInTheDocument()
      expect(screen.getByTestId('expired-status')).toHaveAttribute('role', 'status')
    })

    it('clicking Re-run query triggers retryExpiredResult', async () => {
      const user = userEvent.setup()
      setTabWithExpiredResult()
      let resolveExecute:
        | ((value: {
            queryId: string
            columns: { name: string; dataType: string }[]
            totalRows: number
            executionTimeMs: number
            affectedRows: number
            rows: unknown[][]
            autoLimitApplied: boolean
          }) => void)
        | null = null

      // Override execute_query to succeed
      ipc.override(
        'execute_query',
        () =>
          new Promise<{
            queryId: string
            columns: { name: string; dataType: string }[]
            totalRows: number
            executionTimeMs: number
            affectedRows: number
            rows: unknown[][]
            autoLimitApplied: boolean
          }>((resolve) => {
            resolveExecute = resolve
          })
      )

      render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

      await user.click(screen.getByText('Re-run query'))

      await waitFor(() => {
        expect(screen.getByText('Executing query...')).toBeInTheDocument()
      })
      expect(screen.queryByText('Results expired')).not.toBeInTheDocument()
      expect(screen.queryByTestId('retry-expired-button')).not.toBeInTheDocument()
      ;(
        resolveExecute as
          | ((value: {
              queryId: string
              columns: { name: string; dataType: string }[]
              totalRows: number
              executionTimeMs: number
              affectedRows: number
              rows: unknown[][]
              autoLimitApplied: boolean
            }) => void)
          | null
      )?.({
        queryId: 'q-refreshed',
        columns: [{ name: 'id', dataType: 'INT' }],
        totalRows: 1,
        executionTimeMs: 5,
        affectedRows: 0,
        rows: [[1]],
        autoLimitApplied: false,
      })

      // After retry, isExpired should be cleared
      await waitFor(() => {
        const tab = useQueryStore.getState().tabs[TAB_ID]
        const result = tab?.results[0]
        expect(result?.view.residency.isExpired).toBe(false)
      })
    })

    it('does not show expired banner when isExpired is false', () => {
      act(() => {
        useQueryStore.setState({
          tabs: {
            [TAB_ID]: {
              content: 'SELECT 1',
              selectedText: '',
              filePath: null,
              tabStatus: 'success',
              prevTabStatus: 'idle',
              cursorPosition: null,
              connectionId: CONN_ID,
              results: [
                resultWith({
                  resultStatus: 'success',
                  lastExecutedSql: 'SELECT 1',
                  ...withRows([[1]]),
                  view: {
                    slot: {
                      queryId: 'q-ok',
                      columns: [{ name: 'id', dataType: 'INT' }],
                      totalRows: 1,
                    },
                    residency: { isExpired: false },
                  },
                }),
              ],
              activeResultIndex: 0,
              activeBottomPanelItem: { type: 'result' },
              executionStartedAt: null,
              isCancelling: false,
              wasCancelled: false,
              runExport: null,
            },
          },
        })
      })
      render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

      expect(screen.queryByText('Results expired')).not.toBeInTheDocument()
    })

    it('renders the restoring overlay for frontend row restore without showing expired UI', () => {
      setTabWithRestoringRows()
      render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

      expect(screen.getByTestId('result-panel')).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByTestId('query-result-restore-overlay')).toHaveAttribute('role', 'status')
      expect(screen.getByTestId('query-result-restore-overlay')).toHaveAttribute(
        'aria-live',
        'polite'
      )
      expect(screen.getByText('Restoring cached results…')).toBeInTheDocument()
      expect(screen.queryByText('Results expired')).not.toBeInTheDocument()
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-busy', 'true')
    })

    it('does not block a resident active result when another result in the tab is restoring', () => {
      act(() => {
        useQueryStore.setState({
          tabs: {
            [TAB_ID]: {
              content: 'SELECT 1; SELECT 2',
              selectedText: '',
              filePath: null,
              tabStatus: 'restoring',
              prevTabStatus: 'success',
              cursorPosition: null,
              connectionId: CONN_ID,
              results: [
                resultWith({
                  resultStatus: 'success',
                  ...withRows([[1]]),
                  view: {
                    slot: {
                      queryId: 'q-active-1',
                      columns: [{ name: 'id', dataType: 'INT' }],
                      totalRows: 1,
                    },
                    residency: {
                      rows: {
                        status: 'resident',
                        isActive: true,
                        inactiveSince: null,
                      },
                    },
                  },
                }),
                resultWith({
                  resultStatus: 'success',
                  ...withRows([]),
                  view: {
                    slot: {
                      queryId: 'q-restoring-2',
                      columns: [{ name: 'id', dataType: 'INT' }],
                      totalRows: 1,
                    },
                    residency: {
                      rows: {
                        status: 'restoring',
                        isActive: false,
                        inactiveSince: 123,
                      },
                    },
                  },
                }),
              ],
              activeResultIndex: 0,
              activeBottomPanelItem: { type: 'result' },
              executionStartedAt: null,
              isCancelling: false,
              wasCancelled: false,
              runExport: null,
            },
          },
        })
      })

      render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

      expect(screen.queryByTestId('query-result-restore-overlay')).not.toBeInTheDocument()
      expect(screen.getByTestId('result-panel')).toHaveAttribute('aria-busy', 'false')
    })
  })
})
