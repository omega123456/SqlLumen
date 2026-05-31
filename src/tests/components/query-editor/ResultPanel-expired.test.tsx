import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../../stores/query-store'
import { ipc } from '../../ipc-mock'

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
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-expired-1',
              lastExecutedSql: 'SELECT * FROM users',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [[1]],
              totalRows: 1,
              isExpired: true,
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
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-restoring-1',
              lastExecutedSql: 'SELECT * FROM users',
              columns: [{ name: 'id', dataType: 'INT' }],
              rows: [],
              totalRows: 1,
              rowResidency: {
                status: 'restoring',
                isActive: true,
                inactiveSince: null,
              },
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
            pendingNavigationAction: null,
            executionStartedAt: null,
            isCancelling: false,
            wasCancelled: false,
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
      expect(result?.isExpired).toBe(false)
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
              {
                ...DEFAULT_RESULT_STATE,
                resultStatus: 'success',
                queryId: 'q-ok',
                lastExecutedSql: 'SELECT 1',
                columns: [{ name: 'id', dataType: 'INT' }],
                rows: [[1]],
                totalRows: 1,
                isExpired: false,
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
              {
                ...DEFAULT_RESULT_STATE,
                resultStatus: 'success',
                queryId: 'q-active-1',
                columns: [{ name: 'id', dataType: 'INT' }],
                rows: [[1]],
                totalRows: 1,
                rowResidency: {
                  status: 'resident',
                  isActive: true,
                  inactiveSince: null,
                },
              },
              {
                ...DEFAULT_RESULT_STATE,
                resultStatus: 'success',
                queryId: 'q-restoring-2',
                columns: [{ name: 'id', dataType: 'INT' }],
                rows: [],
                totalRows: 1,
                rowResidency: {
                  status: 'restoring',
                  isActive: false,
                  inactiveSince: 123,
                },
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
    })

    render(<ResultPanel tabId={TAB_ID} connectionId={CONN_ID} />)

    expect(screen.queryByTestId('query-result-restore-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('result-panel')).toHaveAttribute('aria-busy', 'false')
  })
})
