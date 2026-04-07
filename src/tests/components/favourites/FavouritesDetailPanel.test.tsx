import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FavouritesDetailPanel } from '../../../components/favourites/FavouritesDetailPanel'
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

describe('FavouritesDetailPanel', () => {
  it('renders title and description', () => {
    const favourite = makeFavourite()
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('My Query')).toBeInTheDocument()
    expect(screen.getByText('Gets all orders')).toBeInTheDocument()
  })

  it('renders SQL in ElevatedCodePanel', () => {
    const favourite = makeFavourite({ sqlText: 'SELECT 1' })
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
  })

  it('Insert button calls onInsert', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    const favourite = makeFavourite()

    render(<FavouritesDetailPanel favourite={favourite} onInsert={onInsert} onDelete={vi.fn()} />)

    await user.click(screen.getByTestId('favourites-detail-insert'))
    expect(onInsert).toHaveBeenCalledTimes(1)
  })

  it('Delete button calls onDelete', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const favourite = makeFavourite()

    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={onDelete} />)

    await user.click(screen.getByTestId('favourites-detail-delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('shows category when set', () => {
    const favourite = makeFavourite({ category: 'Reports' })
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('Category:')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })

  it('does not show category when null', () => {
    const favourite = makeFavourite({ category: null })
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.queryByText('Category:')).not.toBeInTheDocument()
  })

  it('does not show description when null', () => {
    const favourite = makeFavourite({ description: null })
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.queryByText('Gets all orders')).not.toBeInTheDocument()
  })
})
