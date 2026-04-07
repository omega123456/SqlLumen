import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { FavoritesPanel } from '../../../components/history-favorites/FavoritesPanel'
import { useFavoritesStore } from '../../../stores/favorites-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useQueryStore } from '../../../stores/query-store'
import type { FavoriteEntry } from '../../../types/schema'

function makeFavoriteEntry(overrides: Partial<FavoriteEntry> = {}): FavoriteEntry {
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

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
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
      case 'list_favorites':
        return []
      case 'create_favorite':
        return 1
      case 'update_favorite':
        return true
      case 'delete_favorite':
        return true
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

describe('FavoritesPanel', () => {
  it('shows empty state when there are no favorites', () => {
    render(<FavoritesPanel connectionId="conn-1" />)
    expect(screen.getByTestId('favorites-empty')).toHaveTextContent('No favorites yet')
  })

  it('shows loading state', () => {
    useFavoritesStore.setState({ isLoading: true, entries: [] })
    render(<FavoritesPanel connectionId="conn-1" />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders favorite cards when entries exist', () => {
    useFavoritesStore.setState({
      entries: [makeFavoriteEntry({ id: 1 }), makeFavoriteEntry({ id: 2, name: 'Second Query' })],
    })

    render(<FavoritesPanel connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-card-1')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-card-2')).toBeInTheDocument()
  })

  it('"New Favorite" button opens dialog with null (new mode)', async () => {
    const user = userEvent.setup()
    render(<FavoritesPanel connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorites-add'))

    const state = useFavoritesStore.getState()
    expect(state.dialogOpen).toBe(true)
    expect(state.editingFavorite).toBeNull()
  })

  it('renders the FavoriteDialog when dialogOpen is true', () => {
    useFavoritesStore.setState({ dialogOpen: true, editingFavorite: null })
    render(<FavoritesPanel connectionId="conn-1" />)

    // FavoriteDialog renders via DialogShell into a portal
    expect(screen.getByTestId('favorite-dialog')).toBeInTheDocument()
  })

  it('does not render FavoriteDialog when dialogOpen is false', () => {
    useFavoritesStore.setState({ dialogOpen: false })
    render(<FavoritesPanel connectionId="conn-1" />)
    expect(screen.queryByTestId('favorite-dialog')).not.toBeInTheDocument()
  })

  it('shows error state with retry button when error is set', () => {
    useFavoritesStore.setState({ error: 'Failed to load favorites' })
    render(<FavoritesPanel connectionId="conn-1" />)

    expect(screen.getByTestId('favorites-error')).toBeInTheDocument()
    expect(screen.getByText('Failed to load favorites')).toBeInTheDocument()
    expect(screen.getByTestId('favorites-retry')).toBeInTheDocument()
  })

  it('retry button calls loadFavorites on click', async () => {
    const user = userEvent.setup()
    const loadFavoritesSpy = vi.fn()
    useFavoritesStore.setState({
      error: 'Network error',
      loadFavorites: loadFavoritesSpy,
    })

    render(<FavoritesPanel connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorites-retry'))
    expect(loadFavoritesSpy).toHaveBeenCalledWith('conn-1')
  })

  it('hides entries and empty state when error is set', () => {
    useFavoritesStore.setState({
      error: 'Something went wrong',
      entries: [makeFavoriteEntry()],
    })

    render(<FavoritesPanel connectionId="conn-1" />)

    expect(screen.getByTestId('favorites-error')).toBeInTheDocument()
    expect(screen.queryByTestId('favorite-card-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('favorites-empty')).not.toBeInTheDocument()
  })
})
