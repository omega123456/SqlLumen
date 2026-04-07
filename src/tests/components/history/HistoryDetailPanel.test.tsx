import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryDetailPanel } from '../../../components/history/HistoryDetailPanel'
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

describe('HistoryDetailPanel', () => {
  it('renders empty state when entry is null', () => {
    render(<HistoryDetailPanel entry={null} onOpenInEditor={vi.fn()} />)

    expect(screen.getByTestId('history-detail-empty')).toBeInTheDocument()
    expect(screen.getByText('Select a query to preview')).toBeInTheDocument()
  })

  it('renders entry data when entry is provided', () => {
    const entry = makeHistoryEntry({
      sqlText: 'SELECT * FROM orders',
      durationMs: 125,
      rowCount: 50,
    })

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={vi.fn()} />)

    expect(screen.queryByTestId('history-detail-empty')).not.toBeInTheDocument()
    expect(screen.getByText('SELECT * FROM orders')).toBeInTheDocument()
    expect(screen.getByText('125ms')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('Statement Preview')).toBeInTheDocument()
  })

  it('shows correct status icon for success', () => {
    const entry = makeHistoryEntry({ success: true })

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={vi.fn()} />)

    expect(screen.getByText('Success')).toBeInTheDocument()
  })

  it('shows correct status icon for failure', () => {
    const entry = makeHistoryEntry({
      success: false,
      errorMessage: 'Syntax error near SELECT',
    })

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={vi.fn()} />)

    expect(screen.getByText('Syntax error near SELECT')).toBeInTheDocument()
    expect(screen.queryByText('Success')).not.toBeInTheDocument()
  })

  it('shows "Error" when errorMessage is null but success is false', () => {
    const entry = makeHistoryEntry({ success: false, errorMessage: null })

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={vi.fn()} />)

    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('"Open in Editor" button calls onOpenInEditor', async () => {
    const user = userEvent.setup()
    const onOpenInEditor = vi.fn()
    const entry = makeHistoryEntry()

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={onOpenInEditor} />)

    await user.click(screen.getByTestId('history-open-in-editor'))
    expect(onOpenInEditor).toHaveBeenCalledWith(entry)
  })

  it('shows em-dash for null duration', () => {
    const entry = makeHistoryEntry({ durationMs: null })

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={vi.fn()} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows duration in seconds for >= 1000ms', () => {
    const entry = makeHistoryEntry({ durationMs: 2500 })

    render(<HistoryDetailPanel entry={entry} onOpenInEditor={vi.fn()} />)

    expect(screen.getByText('2.5s')).toBeInTheDocument()
  })
})
