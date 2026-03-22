import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { ResultPanel } from '../../../components/query-editor/ResultPanel'
import { useQueryStore, type TabQueryState } from '../../../stores/query-store'

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  filePath: null,
  status: 'idle',
  columns: [],
  rows: [],
  totalRows: 0,
  executionTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  currentPage: 1,
  totalPages: 1,
  pageSize: 1000,
  autoLimitApplied: false,
  errorMessage: null,
  cursorPosition: null,
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockIPC(() => null)
})

describe('ResultPanel', () => {
  it('renders with data-testid="result-panel"', () => {
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
  })

  it('shows idle state with "Run a query to see results" when no tab state', () => {
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('Run a query to see results')).toBeInTheDocument()
  })

  it('shows idle state when tab has idle status', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': { ...DEFAULT_TAB_STATE, status: 'idle' },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('Run a query to see results')).toBeInTheDocument()
  })

  it('shows running state with "Executing query..." text', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          content: 'SELECT 1',
          status: 'running',
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('Executing query...')).toBeInTheDocument()
  })

  it('shows success state with toolbar and grid', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          status: 'success',
          columns: [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR' },
          ],
          rows: [
            ['1', 'Alice'],
            ['2', 'Bob'],
          ],
          totalRows: 2,
          executionTimeMs: 42,
          queryId: 'q1',
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('result-grid')).toBeInTheDocument()
    expect(screen.getByText(/SUCCESS: 2 ROWS/)).toBeInTheDocument()
  })

  it('shows error state with toolbar and error message', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          status: 'error',
          errorMessage: "Table 'missing' doesn't exist",
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    // Error message appears in both toolbar and body
    const errorTexts = screen.getAllByText("Table 'missing' doesn't exist")
    expect(errorTexts.length).toBeGreaterThanOrEqual(1)
  })

  it('does not show grid or toolbar in idle state', () => {
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('result-toolbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('result-grid')).not.toBeInTheDocument()
  })

  it('does not show grid or toolbar in running state', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': { ...DEFAULT_TAB_STATE, status: 'running' },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByTestId('result-toolbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('result-grid')).not.toBeInTheDocument()
  })

  it('shows grid data in success state', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          status: 'success',
          columns: [{ name: 'val', dataType: 'VARCHAR' }],
          rows: [['hello'], [null]],
          totalRows: 2,
          queryId: 'q1',
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('NULL')).toBeInTheDocument()
  })

  it('shows DML success state with affected rows message', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          status: 'success',
          columns: [],
          rows: [],
          totalRows: 0,
          affectedRows: 3,
          queryId: 'q1',
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('dml-success')).toBeInTheDocument()
    expect(screen.getByText('Query executed: 3 rows affected')).toBeInTheDocument()
    expect(screen.queryByTestId('result-grid')).not.toBeInTheDocument()
  })

  it('shows DDL success state with generic message', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          status: 'success',
          columns: [],
          rows: [],
          totalRows: 0,
          affectedRows: 0,
          queryId: 'q1',
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByText('Query executed successfully')).toBeInTheDocument()
  })

  it('does not show pagination in error state', () => {
    useQueryStore.setState({
      tabs: {
        'tab-1': {
          ...DEFAULT_TAB_STATE,
          status: 'error',
          errorMessage: 'Some error',
        },
      },
    })
    render(<ResultPanel tabId="tab-1" connectionId="conn-1" />)
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })
})
