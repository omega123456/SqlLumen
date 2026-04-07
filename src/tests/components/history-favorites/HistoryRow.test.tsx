import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { HistoryRow } from '../../../components/history-favorites/HistoryRow'
import { useHistoryStore } from '../../../stores/history-store'
import { useFavoritesStore } from '../../../stores/favorites-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useQueryStore } from '../../../stores/query-store'
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
  useFavoritesStore.setState({
    entries: [],
    isLoading: false,
    error: null,
    connectionId: null,
    dialogOpen: false,
    editingFavorite: null,
  })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useQueryStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  vi.clearAllMocks()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'delete_history_entry':
        return true
      case 'list_history':
        return { entries: [], total: 0, page: 1, pageSize: 50 }
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

describe('HistoryRow', () => {
  it('renders SQL text and metadata', () => {
    const entry = makeHistoryEntry()
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    expect(screen.getByText('SELECT * FROM users')).toBeInTheDocument()
    expect(screen.getByText('success')).toBeInTheDocument()
    expect(screen.getByText('10 rows')).toBeInTheDocument()
    expect(screen.getByText('42ms')).toBeInTheDocument()
  })

  it('shows error status and hides row count for error entries', () => {
    const entry = makeHistoryEntry({ success: false, errorMessage: 'Syntax error', rowCount: 0 })
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    expect(screen.getByText('error')).toBeInTheDocument()
    expect(screen.queryByText('0 rows')).not.toBeInTheDocument()
  })

  it('formats duration in seconds for >= 1000ms', () => {
    const entry = makeHistoryEntry({ durationMs: 2500 })
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    expect(screen.getByText('2.5s')).toBeInTheDocument()
  })

  it('clicking row opens query in new editor tab', async () => {
    const user = userEvent.setup()
    const entry = makeHistoryEntry()
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-row-1'))

    // Should have created a workspace tab
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('query-editor')
    expect(tabs[0].label).toBe('History Query')

    // Should have set content in query store
    const queryTab = useQueryStore.getState().tabs[tabs[0].id]
    expect(queryTab?.content).toBe('SELECT * FROM users')
  })

  it('copy button opens query in new editor tab', async () => {
    const user = userEvent.setup()
    const entry = makeHistoryEntry()
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-row-copy'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
  })

  it('favorite button opens dialog with pre-populated data', async () => {
    const user = userEvent.setup()
    const entry = makeHistoryEntry()
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-row-favorite'))

    const state = useFavoritesStore.getState()
    expect(state.dialogOpen).toBe(true)
    expect(state.editingFavorite).toBeTruthy()
    expect(state.editingFavorite?.id).toBe(0)
    expect(state.editingFavorite?.sqlText).toBe('SELECT * FROM users')
    expect(state.editingFavorite?.connectionId).toBe('conn-1')
  })

  it('delete button calls deleteEntry', async () => {
    const user = userEvent.setup()
    const deleteEntrySpy = vi.fn()
    useHistoryStore.setState({ deleteEntry: deleteEntrySpy })
    const entry = makeHistoryEntry()

    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('history-row-delete'))
    expect(deleteEntrySpy).toHaveBeenCalledWith('conn-1', 1)
  })

  it('renders all action buttons', () => {
    const entry = makeHistoryEntry()
    render(<HistoryRow entry={entry} connectionId="conn-1" />)

    expect(screen.getByTestId('history-row-copy')).toBeInTheDocument()
    expect(screen.getByTestId('history-row-favorite')).toBeInTheDocument()
    expect(screen.getByTestId('history-row-delete')).toBeInTheDocument()
  })
})
