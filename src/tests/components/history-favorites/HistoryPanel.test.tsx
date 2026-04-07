import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { HistoryPanel } from '../../../components/history-favorites/HistoryPanel'
import { useHistoryStore } from '../../../stores/history-store'
import type { HistoryEntry } from '../../../types/schema'

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1,
    connectionId: 'conn-1',
    databaseName: 'testdb',
    sqlText: 'SELECT * FROM users',
    timestamp: '2025-06-15T10:30:00Z',
    durationMs: 42,
    rowCount: 10,
    affectedRows: 0,
    success: true,
    errorMessage: null,
    ...overrides,
  }
}

/** Helper to set per-connection state for conn-1. */
function setConnState(overrides: {
  entries?: HistoryEntry[]
  total?: number
  page?: number
  search?: string
  isLoading?: boolean
  error?: string | null
}) {
  const connId = 'conn-1'
  const state = useHistoryStore.getState()
  useHistoryStore.setState({
    entriesByConnection: {
      ...state.entriesByConnection,
      [connId]: overrides.entries ?? state.entriesByConnection[connId] ?? [],
    },
    totalByConnection: {
      ...state.totalByConnection,
      [connId]: overrides.total ?? state.totalByConnection[connId] ?? 0,
    },
    pageByConnection: {
      ...state.pageByConnection,
      [connId]: overrides.page ?? state.pageByConnection[connId] ?? 1,
    },
    searchByConnection: {
      ...state.searchByConnection,
      [connId]: overrides.search ?? state.searchByConnection[connId] ?? '',
    },
    isLoadingByConnection: {
      ...state.isLoadingByConnection,
      [connId]: overrides.isLoading ?? state.isLoadingByConnection[connId] ?? false,
    },
    errorByConnection: {
      ...state.errorByConnection,
      [connId]:
        overrides.error !== undefined ? overrides.error : (state.errorByConnection[connId] ?? null),
    },
  })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useHistoryStore.setState({
    entriesByConnection: {},
    totalByConnection: {},
    pageByConnection: {},
    searchByConnection: {},
    isLoadingByConnection: {},
    errorByConnection: {},
    pageSize: 50,
  })
  vi.clearAllMocks()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'list_history':
        return { entries: [], total: 0, page: 1, pageSize: 50 }
      case 'delete_history_entry':
        return true
      case 'clear_history':
        return 0
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('HistoryPanel', () => {
  it('shows empty state when there are no entries', () => {
    render(<HistoryPanel connectionId="conn-1" />)
    expect(screen.getByTestId('history-empty')).toHaveTextContent('No query history yet')
  })

  it('shows "No matching queries found" when search is active and no results', () => {
    setConnState({ search: 'foobar' })
    render(<HistoryPanel connectionId="conn-1" />)
    expect(screen.getByTestId('history-empty')).toHaveTextContent('No matching queries found')
  })

  it('shows loading state', () => {
    setConnState({ isLoading: true })
    render(<HistoryPanel connectionId="conn-1" />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders history rows when entries exist', () => {
    setConnState({
      entries: [makeHistoryEntry({ id: 1 }), makeHistoryEntry({ id: 2, sqlText: 'SELECT 1' })],
      total: 2,
    })

    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.getByTestId('history-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('history-row-2')).toBeInTheDocument()
  })

  it('search input updates store', async () => {
    const user = userEvent.setup()
    const setSearchSpy = vi.fn()
    useHistoryStore.setState({ setSearch: setSearchSpy })

    render(<HistoryPanel connectionId="conn-1" />)

    const searchInput = screen.getByPlaceholderText('Search queries...')
    await user.type(searchInput, 'SELECT')

    expect(setSearchSpy).toHaveBeenCalled()
  })

  it('clear button calls clearAll', async () => {
    const user = userEvent.setup()
    const clearAllSpy = vi.fn()
    setConnState({ total: 5, entries: [makeHistoryEntry()] })
    useHistoryStore.setState({ clearAll: clearAllSpy })

    render(<HistoryPanel connectionId="conn-1" />)

    const clearBtn = screen.getByTestId('history-clear')
    await user.click(clearBtn)

    expect(clearAllSpy).toHaveBeenCalledWith('conn-1')
  })

  it('clear button is disabled when total is 0', () => {
    setConnState({ total: 0 })
    render(<HistoryPanel connectionId="conn-1" />)

    const clearBtn = screen.getByTestId('history-clear')
    expect(clearBtn).toBeDisabled()
  })

  it('does not show pagination when total <= pageSize', () => {
    setConnState({ total: 10, entries: [makeHistoryEntry()] })
    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.queryByTestId('history-pagination')).not.toBeInTheDocument()
  })

  it('shows pagination when total > pageSize', () => {
    setConnState({ total: 100, page: 1, entries: [makeHistoryEntry()] })
    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.getByTestId('history-pagination')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  it('prev button is disabled on first page', () => {
    setConnState({ total: 100, page: 1, entries: [makeHistoryEntry()] })
    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.getByTestId('history-prev-page')).toBeDisabled()
  })

  it('next button navigates to next page', async () => {
    const user = userEvent.setup()
    const setPageSpy = vi.fn()
    setConnState({ total: 100, page: 1, entries: [makeHistoryEntry()] })
    useHistoryStore.setState({ setPage: setPageSpy })

    render(<HistoryPanel connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-next-page'))
    expect(setPageSpy).toHaveBeenCalledWith('conn-1', 2)
  })

  it('prev button navigates to previous page', async () => {
    const user = userEvent.setup()
    const setPageSpy = vi.fn()
    setConnState({ total: 100, page: 2, entries: [makeHistoryEntry()] })
    useHistoryStore.setState({ setPage: setPageSpy })

    render(<HistoryPanel connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-prev-page'))
    expect(setPageSpy).toHaveBeenCalledWith('conn-1', 1)
  })

  it('next button is disabled on last page', () => {
    setConnState({ total: 100, page: 2, entries: [makeHistoryEntry()] })
    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.getByTestId('history-next-page')).toBeDisabled()
  })

  it('shows error state with retry button when error is set', () => {
    setConnState({ error: 'Failed to load history' })
    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.getByTestId('history-error')).toBeInTheDocument()
    expect(screen.getByText('Failed to load history')).toBeInTheDocument()
    expect(screen.getByTestId('history-retry')).toBeInTheDocument()
  })

  it('retry button calls loadHistory on click', async () => {
    const user = userEvent.setup()
    const loadHistorySpy = vi.fn()
    setConnState({ error: 'Network error', page: 1, search: '' })
    useHistoryStore.setState({ loadHistory: loadHistorySpy })

    render(<HistoryPanel connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-retry'))
    expect(loadHistorySpy).toHaveBeenCalledWith('conn-1', 1, '')
  })

  it('hides entries and empty state when error is set', () => {
    setConnState({
      error: 'Something went wrong',
      entries: [makeHistoryEntry()],
      total: 1,
    })

    render(<HistoryPanel connectionId="conn-1" />)

    expect(screen.getByTestId('history-error')).toBeInTheDocument()
    expect(screen.queryByTestId('history-row-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('history-empty')).not.toBeInTheDocument()
  })
})
