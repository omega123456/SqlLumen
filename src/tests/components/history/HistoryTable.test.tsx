import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { HistoryTable } from '../../../components/history/HistoryTable'
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
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

describe('HistoryTable', () => {
  it('renders entries in table rows', () => {
    const entries = [
      makeHistoryEntry({ id: 1, sqlText: 'SELECT 1' }),
      makeHistoryEntry({ id: 2, sqlText: 'SELECT 2' }),
    ]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByTestId('history-table-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('history-table-row-2')).toBeInTheDocument()
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
    expect(screen.getByText('SELECT 2')).toBeInTheDocument()
  })

  it('shows empty state when there are no entries', () => {
    render(
      <HistoryTable
        entries={[]}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByTestId('history-table-empty')).toBeInTheDocument()
    expect(screen.getByText('No query history yet')).toBeInTheDocument()
  })

  it('clicking a row calls onSelectEntry', async () => {
    const user = userEvent.setup()
    const onSelectEntry = vi.fn()
    const entries = [makeHistoryEntry({ id: 42 })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={onSelectEntry}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    await user.click(screen.getByTestId('history-table-row-42'))
    expect(onSelectEntry).toHaveBeenCalledWith(42)
  })

  it('selected row has correct aria-selected state', () => {
    const entries = [makeHistoryEntry({ id: 1 }), makeHistoryEntry({ id: 2 })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={1}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByTestId('history-table-row-1')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('history-table-row-2')).toHaveAttribute('aria-selected', 'false')
  })

  it('entry count badge shows correct count', () => {
    const entries = [
      makeHistoryEntry({ id: 1 }),
      makeHistoryEntry({ id: 2 }),
      makeHistoryEntry({ id: 3 }),
    ]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByTestId('history-count-badge')).toHaveTextContent('3 entries')
  })

  it('shows singular "entry" for single item', () => {
    const entries = [makeHistoryEntry({ id: 1 })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByTestId('history-count-badge')).toHaveTextContent('1 entry')
  })

  it('"Load older history" button calls setPage (load more)', async () => {
    const user = userEvent.setup()
    const setPageSpy = vi.fn()
    useHistoryStore.setState({
      totalByConnection: { 'conn-1': 100 },
      pageByConnection: { 'conn-1': 1 },
      setPage: setPageSpy,
    })

    const entries = [makeHistoryEntry({ id: 1 })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    const loadMoreBtn = screen.getByTestId('history-load-more')
    expect(loadMoreBtn).toBeInTheDocument()
    await user.click(loadMoreBtn)
    expect(setPageSpy).toHaveBeenCalledWith('conn-1', 2)
  })

  it('does not show "Load older history" button when on last page', () => {
    useHistoryStore.setState({
      totalByConnection: { 'conn-1': 10 },
      pageByConnection: { 'conn-1': 1 },
    })

    const entries = [makeHistoryEntry({ id: 1 })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.queryByTestId('history-load-more')).not.toBeInTheDocument()
  })

  it('renders database and timestamp columns', () => {
    const entries = [
      makeHistoryEntry({
        id: 1,
        databaseName: 'mydb',
        timestamp: '2025-06-15T10:30:00Z',
      }),
    ]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByText('mydb')).toBeInTheDocument()
  })

  it('renders em-dash for null database', () => {
    const entries = [makeHistoryEntry({ id: 1, databaseName: null })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('clicking ACTION button calls onOpenInEditor', async () => {
    const user = userEvent.setup()
    const onOpenInEditor = vi.fn()
    const entry = makeHistoryEntry({ id: 7 })

    render(
      <HistoryTable
        entries={[entry]}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={onOpenInEditor}
        connectionId="conn-1"
      />
    )

    await user.click(screen.getByTestId('history-action-open-7'))
    expect(onOpenInEditor).toHaveBeenCalledWith(entry)
  })

  it('double-clicking a row calls onOpenInEditor', async () => {
    const user = userEvent.setup()
    const onOpenInEditor = vi.fn()
    const entry = makeHistoryEntry({ id: 9 })

    render(
      <HistoryTable
        entries={[entry]}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onOpenInEditor={onOpenInEditor}
        connectionId="conn-1"
      />
    )

    await user.dblClick(screen.getByTestId('history-table-row-9'))
    expect(onOpenInEditor).toHaveBeenCalledWith(entry)
  })

  it('pressing Enter on a row calls onSelectEntry', async () => {
    const user = userEvent.setup()
    const onSelectEntry = vi.fn()
    const entries = [makeHistoryEntry({ id: 5 })]

    render(
      <HistoryTable
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={onSelectEntry}
        onOpenInEditor={vi.fn()}
        connectionId="conn-1"
      />
    )

    const row = screen.getByTestId('history-table-row-5')
    row.focus()
    await user.keyboard('{Enter}')
    expect(onSelectEntry).toHaveBeenCalledWith(5)
  })
})
