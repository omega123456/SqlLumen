import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPaletteResults } from '../../../components/command-palette/CommandPaletteResults'
import type { PaletteSearchResult } from '../../../lib/command-palette-search'

function makeResult(overrides: Partial<PaletteSearchResult> = {}): PaletteSearchResult {
  return {
    database: 'analytics',
    objectType: 'table',
    name: 'users',
    score: 0.1,
    matchIndices: [],
    recentRank: null,
    ...overrides,
  }
}

describe('CommandPaletteResults', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the recents header and recent badge rows', () => {
    render(
      <CommandPaletteResults
        results={[makeResult(), makeResult({ name: 'user_rollup', objectType: 'view' })]}
        activeIndex={0}
        state="recents"
        onSelect={() => {}}
      />
    )

    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getAllByLabelText('Recent object')).toHaveLength(2)
  })

  it('renders fuzzy highlight markup in the object name', () => {
    render(
      <CommandPaletteResults
        results={[
          makeResult({
            matchIndices: [
              [0, 1],
              [4, 4],
            ],
          }),
        ]}
        activeIndex={0}
        state="results"
        onSelect={() => {}}
      />
    )

    const option = screen.getByRole('option', { name: /users/i })
    const strongSegments = option.querySelectorAll('strong')
    expect(Array.from(strongSegments).map((node) => node.textContent)).toEqual(['us', 's'])
  })

  it('renders column metadata and scoped labels', () => {
    render(
      <CommandPaletteResults
        results={[
          makeResult({
            table: 'orders',
            objectType: 'column',
            name: 'total',
            metaLabel: 'DECIMAL(12,2)',
          }),
        ]}
        activeIndex={0}
        state="recents"
        isColumnScope
        onSelect={() => {}}
      />
    )

    expect(screen.getByText('Columns')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: 'Columns' })).toBeInTheDocument()
    expect(screen.getByLabelText('Type DECIMAL(12,2)')).toHaveTextContent('DECIMAL(12,2)')
    expect(screen.queryByLabelText('Recent object')).not.toBeInTheDocument()
  })

  it('scrolls the active row into view when the active index changes', () => {
    const scrollIntoView = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView)

    const results = [
      makeResult({ name: 'users' }),
      makeResult({ name: 'user_rollup', objectType: 'view' }),
    ]

    const { rerender } = render(
      <CommandPaletteResults
        results={results}
        activeIndex={0}
        state="results"
        onSelect={() => {}}
      />
    )

    scrollIntoView.mockClear()

    rerender(
      <CommandPaletteResults
        results={results}
        activeIndex={1}
        state="results"
        onSelect={() => {}}
      />
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('invokes selection when a row is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <CommandPaletteResults
        results={[makeResult({ name: 'users_after_insert', objectType: 'trigger' })]}
        activeIndex={0}
        state="results"
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByRole('option', { name: /users_after_insert/i }))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'users_after_insert',
        objectType: 'trigger',
      })
    )
  })

  it('renders loading, empty, no-results, and no-connection states', () => {
    const { rerender } = render(
      <CommandPaletteResults results={[]} activeIndex={0} state="loading" onSelect={() => {}} />
    )

    expect(screen.getByTestId('command-palette-loading-state')).toHaveTextContent(
      'Loading schema objects'
    )

    rerender(
      <CommandPaletteResults results={[]} activeIndex={0} state="empty" onSelect={() => {}} />
    )
    expect(screen.getByTestId('command-palette-empty-state')).toHaveTextContent(
      'No recent objects yet'
    )

    rerender(
      <CommandPaletteResults results={[]} activeIndex={0} state="no-results" onSelect={() => {}} />
    )
    expect(screen.getByTestId('command-palette-no-results')).toHaveTextContent(
      'No matching objects'
    )

    rerender(
      <CommandPaletteResults
        results={[]}
        activeIndex={0}
        state="no-connection"
        onSelect={() => {}}
      />
    )
    expect(screen.getByTestId('command-palette-empty-state')).toHaveTextContent(
      'No active connection'
    )
  })
})
