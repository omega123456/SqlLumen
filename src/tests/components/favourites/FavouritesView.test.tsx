import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { FavouritesView } from '../../../components/favourites/FavouritesView'
import { useFavoritesStore } from '../../../stores/favorites-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useQueryStore } from '../../../stores/query-store'
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

/** No-op loadFavorites — prevents useEffect from clearing pre-set state. */
const noopLoadFavorites = vi.fn()

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

describe('FavouritesView', () => {
  it('renders header with title', () => {
    useFavoritesStore.setState({ loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)
    expect(screen.getByText('Favourites')).toBeInTheDocument()
  })

  it('renders New Snippet button', () => {
    useFavoritesStore.setState({ loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)
    expect(screen.getByTestId('favourites-new-snippet')).toBeInTheDocument()
  })

  it('renders search input', () => {
    useFavoritesStore.setState({ loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)
    expect(screen.getByTestId('favourites-search')).toBeInTheDocument()
  })

  it('shows empty state when there are no favourites', () => {
    useFavoritesStore.setState({ loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)
    expect(screen.getByTestId('favourites-empty')).toHaveTextContent('No favourites yet')
  })

  it('renders favourite cards when entries exist', () => {
    useFavoritesStore.setState({
      entries: [makeFavourite({ id: 1 }), makeFavourite({ id: 2, name: 'Second Query' })],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    expect(screen.getByTestId('favourites-snippet-card-1')).toBeInTheDocument()
    expect(screen.getByTestId('favourites-snippet-card-2')).toBeInTheDocument()
  })

  it('search filters the list by name', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({
      entries: [
        makeFavourite({ id: 1, name: 'Alpha Query' }),
        makeFavourite({ id: 2, name: 'Beta Query' }),
      ],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    await user.type(screen.getByTestId('favourites-search'), 'Alpha')

    expect(screen.getByTestId('favourites-snippet-card-1')).toBeInTheDocument()
    expect(screen.queryByTestId('favourites-snippet-card-2')).not.toBeInTheDocument()
  })

  it('search filters the list by description', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({
      entries: [
        makeFavourite({ id: 1, name: 'Alpha', description: 'Finds all users' }),
        makeFavourite({ id: 2, name: 'Beta', description: 'Finds all orders' }),
      ],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    await user.type(screen.getByTestId('favourites-search'), 'orders')

    expect(screen.queryByTestId('favourites-snippet-card-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('favourites-snippet-card-2')).toBeInTheDocument()
  })

  it('Insert opens query tab and sets content', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({
      entries: [makeFavourite({ id: 1, name: 'My Query', sqlText: 'SELECT 1' })],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    await user.click(screen.getByTestId('snippet-card-insert'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('query-editor')
    expect(tabs[0].label).toBe('My Query')

    const queryTab = useQueryStore.getState().tabs[tabs[0].id]
    expect(queryTab?.content).toBe('SELECT 1')
  })

  it('create new opens dialog with null', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({ loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)

    await user.click(screen.getByTestId('favourites-new-snippet'))

    const state = useFavoritesStore.getState()
    expect(state.dialogOpen).toBe(true)
    expect(state.editingFavorite).toBeNull()
  })

  it('edit opens dialog with favourite data', async () => {
    const user = userEvent.setup()
    const entry = makeFavourite({ id: 1 })
    useFavoritesStore.setState({ entries: [entry], loadFavorites: noopLoadFavorites })

    render(<FavouritesView connectionId="conn-1" />)

    await user.click(screen.getByTestId('snippet-card-edit'))

    const state = useFavoritesStore.getState()
    expect(state.dialogOpen).toBe(true)
    expect(state.editingFavorite?.id).toBe(1)
  })

  it('delete calls store action after confirmation', async () => {
    const user = userEvent.setup()
    const deleteFavoriteSpy = vi.fn()
    const entry = makeFavourite({ id: 1 })
    useFavoritesStore.setState({
      entries: [entry],
      deleteFavorite: deleteFavoriteSpy,
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    // Select the card first to show detail panel with delete button
    await user.click(screen.getByTestId('favourites-snippet-card-1'))

    await user.click(screen.getByTestId('favourites-detail-delete'))

    // Confirmation dialog should appear
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    expect(screen.getByText('Delete Favourite')).toBeInTheDocument()

    // deleteFavorite should NOT have been called yet
    expect(deleteFavoriteSpy).not.toHaveBeenCalled()

    // Confirm deletion
    await user.click(screen.getByTestId('confirm-confirm-button'))
    expect(deleteFavoriteSpy).toHaveBeenCalledWith(1)
  })

  it('cancel delete confirmation does not delete', async () => {
    const user = userEvent.setup()
    const deleteFavoriteSpy = vi.fn()
    const entry = makeFavourite({ id: 1 })
    useFavoritesStore.setState({
      entries: [entry],
      deleteFavorite: deleteFavoriteSpy,
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    // Select the card first to show detail panel with delete button
    await user.click(screen.getByTestId('favourites-snippet-card-1'))

    await user.click(screen.getByTestId('favourites-detail-delete'))

    // Confirmation dialog should appear
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

    // Cancel deletion
    await user.click(screen.getByTestId('confirm-cancel-button'))
    expect(deleteFavoriteSpy).not.toHaveBeenCalled()

    // Dialog should be closed
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })

  it('loads favourites on mount', () => {
    const loadFavoritesSpy = vi.fn()
    useFavoritesStore.setState({ loadFavorites: loadFavoritesSpy })

    render(<FavouritesView connectionId="conn-1" />)

    expect(loadFavoritesSpy).toHaveBeenCalledWith('conn-1')
  })

  it('renders FavoriteDialog when dialogOpen is true', () => {
    useFavoritesStore.setState({
      dialogOpen: true,
      editingFavorite: null,
      loadFavorites: noopLoadFavorites,
    })
    render(<FavouritesView connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-dialog')).toBeInTheDocument()
  })

  it('does not render FavoriteDialog when dialogOpen is false', () => {
    useFavoritesStore.setState({ dialogOpen: false, loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)
    expect(screen.queryByTestId('favorite-dialog')).not.toBeInTheDocument()
  })

  it('shows error state with retry button', () => {
    useFavoritesStore.setState({ error: 'Failed to load', loadFavorites: noopLoadFavorites })
    render(<FavouritesView connectionId="conn-1" />)

    expect(screen.getByTestId('favourites-error')).toBeInTheDocument()
    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    expect(screen.getByTestId('favourites-retry')).toBeInTheDocument()
  })

  it('shows no matching snippets when search has no results', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({
      entries: [makeFavourite({ id: 1, name: 'Alpha Query' })],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    await user.type(screen.getByTestId('favourites-search'), 'zzzzz')

    expect(screen.getByTestId('favourites-no-results')).toHaveTextContent('No matching snippets')
  })

  it('selecting a card shows inline detail panel', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({
      entries: [makeFavourite({ id: 1 })],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    // Detail panel shouldn't be visible initially
    expect(screen.queryByTestId('favourites-detail-panel')).not.toBeInTheDocument()

    // Click the card to select it
    await user.click(screen.getByTestId('favourites-snippet-card-1'))

    // Detail panel should now be visible
    expect(screen.getByTestId('favourites-detail-panel')).toBeInTheDocument()
  })

  it('clicking a selected card deselects it and hides detail panel', async () => {
    const user = userEvent.setup()
    useFavoritesStore.setState({
      entries: [makeFavourite({ id: 1 })],
      loadFavorites: noopLoadFavorites,
    })

    render(<FavouritesView connectionId="conn-1" />)

    // Select the card
    await user.click(screen.getByTestId('favourites-snippet-card-1'))
    expect(screen.getByTestId('favourites-detail-panel')).toBeInTheDocument()

    // Click again to deselect
    await user.click(screen.getByTestId('favourites-snippet-card-1'))
    expect(screen.queryByTestId('favourites-detail-panel')).not.toBeInTheDocument()
  })
})
