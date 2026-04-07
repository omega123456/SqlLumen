import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { FavoriteCard } from '../../../components/history-favorites/FavoriteCard'
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
      case 'delete_favorite':
        return true
      case 'list_favorites':
        return []
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

describe('FavoriteCard', () => {
  it('renders favorite name, SQL, and metadata', () => {
    const entry = makeFavoriteEntry()
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    expect(screen.getByText('My Query')).toBeInTheDocument()
    expect(screen.getByText('SELECT * FROM orders')).toBeInTheDocument()
    expect(screen.getByText('shopdb')).toBeInTheDocument()
    expect(screen.getByText('Gets all orders')).toBeInTheDocument()
  })

  it('renders without description when description is null', () => {
    const entry = makeFavoriteEntry({ description: null })
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    expect(screen.getByText('My Query')).toBeInTheDocument()
    expect(screen.queryByText('Gets all orders')).not.toBeInTheDocument()
  })

  it('renders without category when category is null', () => {
    const entry = makeFavoriteEntry({ category: null })
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    expect(screen.queryByText('shopdb')).not.toBeInTheDocument()
  })

  it('clicking card opens query in new editor tab', async () => {
    const user = userEvent.setup()
    const entry = makeFavoriteEntry()
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorite-card-1'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('query-editor')
    expect(tabs[0].label).toBe('My Query')

    const queryTab = useQueryStore.getState().tabs[tabs[0].id]
    expect(queryTab?.content).toBe('SELECT * FROM orders')
  })

  it('copy button opens query in new editor tab', async () => {
    const user = userEvent.setup()
    const entry = makeFavoriteEntry()
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorite-card-copy'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
  })

  it('edit button opens dialog with entry data', async () => {
    const user = userEvent.setup()
    const entry = makeFavoriteEntry()
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorite-card-edit'))

    const state = useFavoritesStore.getState()
    expect(state.dialogOpen).toBe(true)
    expect(state.editingFavorite?.id).toBe(1)
    expect(state.editingFavorite?.name).toBe('My Query')
    expect(state.editingFavorite?.sqlText).toBe('SELECT * FROM orders')
  })

  it('delete button calls deleteFavorite', async () => {
    const user = userEvent.setup()
    const deleteFavoriteSpy = vi.fn()
    useFavoritesStore.setState({ deleteFavorite: deleteFavoriteSpy })
    const entry = makeFavoriteEntry()

    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorite-card-delete'))
    expect(deleteFavoriteSpy).toHaveBeenCalledWith(1)
  })

  it('renders all action buttons', () => {
    const entry = makeFavoriteEntry()
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-card-copy')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-card-edit')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-card-delete')).toBeInTheDocument()
  })

  it('uses entry name as editor tab label', async () => {
    const user = userEvent.setup()
    const entry = makeFavoriteEntry({ name: 'Custom Name' })
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorite-card-1'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs[0].label).toBe('Custom Name')
  })

  it('uses "Favorite Query" as fallback label when name is empty', async () => {
    const user = userEvent.setup()
    const entry = makeFavoriteEntry({ name: '' })
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    await user.click(screen.getByTestId('favorite-card-1'))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs[0].label).toBe('Favorite Query')
  })

  it('shows global badge when connectionId is null', () => {
    const entry = makeFavoriteEntry({ connectionId: null })
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByTitle('Global (all connections)')).toBeInTheDocument()
  })

  it('does not show global badge when connectionId is set', () => {
    const entry = makeFavoriteEntry({ connectionId: 'conn-1' })
    render(<FavoriteCard entry={entry} connectionId="conn-1" />)

    expect(screen.queryByText('Global')).not.toBeInTheDocument()
  })
})
