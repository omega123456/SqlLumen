import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FavouritesDetailPanel } from '../../../components/favourites/FavouritesDetailPanel'
import type { FavoriteEntry } from '../../../types/schema'

function makeFavourite(overrides: Partial<FavoriteEntry> = {}): FavoriteEntry {
  return {
    id: 1,
    name: 'My query',
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

    expect(screen.getByText('My query')).toBeInTheDocument()
    expect(screen.getByText('Gets all orders')).toBeInTheDocument()
  })

  it('renders SQL in ElevatedCodePanel', () => {
    const favourite = makeFavourite({ sqlText: 'SELECT 1' })
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
    expect(screen.getByText('SQL')).toBeInTheDocument()
  })

  it('shows category when set', () => {
    const favourite = makeFavourite({ category: 'Reports' })
    render(<FavouritesDetailPanel favourite={favourite} onInsert={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('Category:')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })
})
