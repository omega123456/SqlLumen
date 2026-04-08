import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavouritesSnippetCard } from '../../../components/favourites/FavouritesSnippetCard'
import type { FavoriteEntry } from '../../../types/schema'

function makeFavourite(overrides: Partial<FavoriteEntry> = {}): FavoriteEntry {
  return {
    id: 1,
    name: 'My Query',
    sqlText: 'SELECT * FROM orders',
    description: 'Gets all orders',
    category: 'shopdb',
    connectionId: 'conn-1',
    createdAt: '2025-06-15T10:00:00Z',
    updatedAt: '2025-06-15T10:00:00Z',
    ...overrides,
  }
}

describe('FavouritesSnippetCard', () => {
  it('renders name and description', () => {
    const favourite = makeFavourite()
    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    expect(screen.getByTestId('favourites-snippet-card-1')).toHaveClass('ui-elevated-surface')
    expect(screen.getByText('My Query')).toBeInTheDocument()
    expect(screen.getByText('Gets all orders')).toBeInTheDocument()
  })

  it('renders tags when category is set', () => {
    const favourite = makeFavourite({ category: 'Reports' })
    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('does not render tags when category is null', () => {
    const favourite = makeFavourite({ category: null })
    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    expect(screen.queryByText('shopdb')).not.toBeInTheDocument()
  })

  it('edit button calls onEdit', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const favourite = makeFavourite()

    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={onEdit}
        onInsert={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('snippet-card-edit'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('insert button calls onInsert', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    const favourite = makeFavourite()

    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={onInsert}
      />
    )

    await user.click(screen.getByTestId('snippet-card-insert'))
    expect(onInsert).toHaveBeenCalledTimes(1)
  })

  it('applies selected state styling', () => {
    const favourite = makeFavourite()
    const { container } = render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={true}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    const card = container.querySelector('[data-testid="favourites-snippet-card-1"]')
    expect(card?.className).toContain('cardSelected')
  })

  it('onClick calls onSelect', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const favourite = makeFavourite()

    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    await user.click(screen.getByTestId('favourites-snippet-card-1'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('does not render description when null', () => {
    const favourite = makeFavourite({ description: null })
    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    expect(screen.queryByText('Gets all orders')).not.toBeInTheDocument()
  })

  it('renders formatted date in meta row', () => {
    const favourite = makeFavourite({ updatedAt: '2025-06-15T10:00:00Z' })
    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    // The exact format depends on locale, but should contain Jun/June and 2025
    expect(screen.getByText(/2025/)).toBeInTheDocument()
  })

  it('has role="button" and tabIndex={0} for keyboard accessibility', () => {
    const favourite = makeFavourite()
    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    const card = screen.getByTestId('favourites-snippet-card-1')
    expect(card).toHaveAttribute('role', 'button')
    expect(card).toHaveAttribute('tabindex', '0')
  })

  it('has aria-expanded attribute reflecting selection state', () => {
    const favourite = makeFavourite()
    const { rerender } = render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    expect(screen.getByTestId('favourites-snippet-card-1')).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={true}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    expect(screen.getByTestId('favourites-snippet-card-1')).toHaveAttribute('aria-expanded', 'true')
  })

  it('pressing Enter on card calls onSelect', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const favourite = makeFavourite()

    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    const card = screen.getByTestId('favourites-snippet-card-1')
    card.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('pressing Space on card calls onSelect', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const favourite = makeFavourite()

    render(
      <FavouritesSnippetCard
        favourite={favourite}
        isSelected={false}
        onSelect={onSelect}
        onEdit={vi.fn()}
        onInsert={vi.fn()}
      />
    )

    const card = screen.getByTestId('favourites-snippet-card-1')
    card.focus()
    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
