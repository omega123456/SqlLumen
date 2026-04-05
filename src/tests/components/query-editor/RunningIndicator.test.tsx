import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RunningIndicator } from '../../../components/query-editor/RunningIndicator'
import { useQueryStore, type TabQueryState } from '../../../stores/query-store'

const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  filePath: null,
  status: 'running',
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
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  exportDialogOpen: false,
  lastExecutedSql: null,
  editMode: null,
  editTableMetadata: {},
  editForeignKeys: [],
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: new Map(),
  editColumnBindings: new Map(),
  editBoundColumnIndexMap: new Map(),
  pendingNavigationAction: null,
  saveError: null,
  editConnectionId: null,
  editingRowIndex: null,
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
}

function setupTabState(overrides: Partial<TabQueryState> = {}) {
  useQueryStore.setState({
    tabs: {
      'tab-1': { ...DEFAULT_TAB_STATE, ...overrides },
    },
  })
}

let executionStartMs = 0

beforeEach(() => {
  executionStartMs = Date.now()
  setupTabState({ executionStartedAt: executionStartMs })
})

afterEach(() => {
  useQueryStore.setState({ tabs: {} })
})

describe('RunningIndicator', () => {
  it('renders with correct data-testid attributes', () => {
    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    expect(screen.getByTestId('running-indicator')).toBeInTheDocument()
    expect(screen.getByTestId('running-timer')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-query-button')).toBeInTheDocument()
  })

  it('has an accessible status region with role="status" and aria-live="polite"', () => {
    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    const statusRegion = screen.getByRole('status')
    expect(statusRegion).toHaveAttribute('aria-live', 'polite')
    expect(statusRegion).toHaveTextContent('Running')
  })

  it('displays "RUNNING" label', () => {
    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    expect(screen.getByText('RUNNING')).toBeInTheDocument()
  })

  it('timer shows formatted elapsed time', () => {
    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    expect(screen.getByTestId('running-timer')).toHaveTextContent('0s')
  })

  it('calls cancelQuery when cancel button is clicked', () => {
    const mockCancelQuery = vi.fn().mockResolvedValue(undefined)
    useQueryStore.setState({ cancelQuery: mockCancelQuery })

    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    act(() => {
      fireEvent.click(screen.getByTestId('cancel-query-button'))
    })
    expect(mockCancelQuery).toHaveBeenCalledWith('conn-1', 'tab-1')
  })

  it('shows "Cancel" text when not cancelling', () => {
    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-query-button')).not.toBeDisabled()
  })

  it('shows "Cancelling..." and is disabled when isCancelling is true', () => {
    setupTabState({
      executionStartedAt: executionStartMs,
      isCancelling: true,
      wasCancelled: true,
    })

    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    expect(screen.getByText('Cancelling...')).toBeInTheDocument()
    expect(screen.getByTestId('cancel-query-button')).toBeDisabled()
  })

  it('renders the spinner element', () => {
    render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
    const container = screen.getByTestId('running-indicator')
    const spinner = container.querySelector('span')
    expect(spinner).toBeInTheDocument()
  })

  describe('elapsed timer (fake timers)', () => {
    const FIXED_START = Date.UTC(2025, 2, 1, 12, 0, 0)

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(FIXED_START)
      setupTabState({ executionStartedAt: FIXED_START })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('timer increments every second', () => {
      render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)
      expect(screen.getByTestId('running-timer')).toHaveTextContent('0s')

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByTestId('running-timer')).toHaveTextContent('1s')

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByTestId('running-timer')).toHaveTextContent('3s')
    })

    it('timer formats minutes correctly', () => {
      render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)

      act(() => {
        vi.advanceTimersByTime(65000)
      })
      expect(screen.getByTestId('running-timer')).toHaveTextContent('1m 5s')
    })

    it('cleans up interval on unmount', () => {
      const { unmount } = render(<RunningIndicator connectionId="conn-1" tabId="tab-1" />)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.getByTestId('running-timer')).toHaveTextContent('1s')

      unmount()

      act(() => {
        vi.advanceTimersByTime(5000)
      })
    })
  })
})
