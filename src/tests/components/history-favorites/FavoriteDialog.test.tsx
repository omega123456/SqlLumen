import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { FavoriteDialog } from '../../../components/history-favorites/FavoriteDialog'
import { useFavoritesStore } from '../../../stores/favorites-store'
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
    connectionId: 'conn-1',
    dialogOpen: true,
    editingFavorite: null,
  })
  vi.clearAllMocks()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'create_favorite':
        return 1
      case 'update_favorite':
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

describe('FavoriteDialog', () => {
  it('renders in "New Favorite" mode when editingFavorite is null', () => {
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-dialog-panel')).toHaveClass('ui-elevated-surface')
    expect(screen.getByText('New Favorite')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-dialog-save')).toHaveTextContent('Save')
  })

  it('renders in "Edit Favorite" mode when editingFavorite has id', () => {
    useFavoritesStore.setState({ editingFavorite: makeFavoriteEntry() })
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByText('Edit Favorite')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-dialog-save')).toHaveTextContent('Update')
  })

  it('pre-populates fields when editing', () => {
    useFavoritesStore.setState({ editingFavorite: makeFavoriteEntry() })
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-name-input')).toHaveValue('My Query')
    expect(screen.getByTestId('favorite-sql-input')).toHaveValue('SELECT * FROM orders')
    expect(screen.getByTestId('favorite-category-input')).toHaveValue('shopdb')
    expect(screen.getByTestId('favorite-description-input')).toHaveValue('Gets all orders')
  })

  it('fields are empty for new favorite', () => {
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-name-input')).toHaveValue('')
    expect(screen.getByTestId('favorite-sql-input')).toHaveValue('')
    expect(screen.getByTestId('favorite-category-input')).toHaveValue('')
    expect(screen.getByTestId('favorite-description-input')).toHaveValue('')
  })

  it('save button is disabled when name is empty', () => {
    render(<FavoriteDialog connectionId="conn-1" />)

    // Both name and SQL are empty — button should be disabled
    expect(screen.getByTestId('favorite-dialog-save')).toBeDisabled()
  })

  it('save button is disabled when sqlText is empty', () => {
    render(<FavoriteDialog connectionId="conn-1" />)

    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Test' },
    })

    // SQL is still empty
    expect(screen.getByTestId('favorite-dialog-save')).toBeDisabled()
  })

  it('save button is enabled when both name and sqlText are filled', () => {
    render(<FavoriteDialog connectionId="conn-1" />)

    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Test' },
    })
    fireEvent.change(screen.getByTestId('favorite-sql-input'), {
      target: { value: 'SELECT 1' },
    })

    expect(screen.getByTestId('favorite-dialog-save')).not.toBeDisabled()
  })

  it('calls createFavorite when saving a new favorite', async () => {
    const createFavoriteSpy = vi.fn().mockResolvedValue(1)
    useFavoritesStore.setState({ createFavorite: createFavoriteSpy })

    render(<FavoriteDialog connectionId="conn-1" />)

    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'New Fav' },
    })
    fireEvent.change(screen.getByTestId('favorite-sql-input'), {
      target: { value: 'SELECT 1' },
    })
    fireEvent.change(screen.getByTestId('favorite-category-input'), {
      target: { value: 'mycat' },
    })
    fireEvent.change(screen.getByTestId('favorite-description-input'), {
      target: { value: 'Some description' },
    })

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(createFavoriteSpy).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        name: 'New Fav',
        sqlText: 'SELECT 1',
        category: 'mycat',
        description: 'Some description',
      })
    })
  })

  it('calls updateFavorite when saving an edited favorite', async () => {
    const updateFavoriteSpy = vi.fn().mockResolvedValue(true)
    useFavoritesStore.setState({
      editingFavorite: makeFavoriteEntry(),
      updateFavorite: updateFavoriteSpy,
    })

    render(<FavoriteDialog connectionId="conn-1" />)

    // Change the name
    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Updated Name' },
    })

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(updateFavoriteSpy).toHaveBeenCalledWith(1, {
        name: 'Updated Name',
        sqlText: 'SELECT * FROM orders',
        category: 'shopdb',
        description: 'Gets all orders',
        connectionId: 'conn-1',
      })
    })
  })

  it('cancel button calls closeDialog', () => {
    const closeDialogSpy = vi.fn()
    useFavoritesStore.setState({ closeDialog: closeDialogSpy })

    render(<FavoriteDialog connectionId="conn-1" />)
    fireEvent.click(screen.getByTestId('favorite-dialog-cancel'))

    expect(closeDialogSpy).toHaveBeenCalled()
  })

  it('closes dialog after successful save', async () => {
    const closeDialogSpy = vi.fn()
    const createFavoriteSpy = vi.fn().mockResolvedValue(1)
    useFavoritesStore.setState({
      createFavorite: createFavoriteSpy,
      closeDialog: closeDialogSpy,
    })

    render(<FavoriteDialog connectionId="conn-1" />)

    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Test' },
    })
    fireEvent.change(screen.getByTestId('favorite-sql-input'), {
      target: { value: 'SELECT 1' },
    })

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(closeDialogSpy).toHaveBeenCalled()
    })
  })

  it('pre-populates SQL from history entry (save-as-favorite flow)', () => {
    // This simulates clicking "Save as Favorite" from a history row —
    // editingFavorite has id=0 but has sqlText populated
    useFavoritesStore.setState({
      editingFavorite: {
        id: 0,
        name: '',
        sqlText: 'SELECT * FROM history_query',
        description: null,
        category: null,
        connectionId: 'conn-1',
        createdAt: '',
        updatedAt: '',
      },
    })

    render(<FavoriteDialog connectionId="conn-1" />)

    // Should be in "New" mode (not "Edit") because id is 0 (falsy)
    expect(screen.getByText('New Favorite')).toBeInTheDocument()
    // But SQL should be pre-populated
    expect(screen.getByTestId('favorite-sql-input')).toHaveValue('SELECT * FROM history_query')
  })

  it('description and category are sent as null when empty', async () => {
    const createFavoriteSpy = vi.fn().mockResolvedValue(1)
    useFavoritesStore.setState({ createFavorite: createFavoriteSpy })

    render(<FavoriteDialog connectionId="conn-1" />)

    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Test' },
    })
    fireEvent.change(screen.getByTestId('favorite-sql-input'), {
      target: { value: 'SELECT 1' },
    })
    // Leave category and description empty

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(createFavoriteSpy).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        name: 'Test',
        sqlText: 'SELECT 1',
        category: null,
        description: null,
      })
    })
  })

  it('shows scope dropdown for new favorites', () => {
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-scope-dropdown')).toBeInTheDocument()
    // Default scope is "This connection only"
    expect(screen.getByTestId('favorite-scope-dropdown')).toHaveTextContent('This connection only')
  })

  it('shows scope dropdown when editing', () => {
    useFavoritesStore.setState({ editingFavorite: makeFavoriteEntry() })
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-scope-dropdown')).toBeInTheDocument()
    // Should show "This connection only" since the favorite has a connectionId
    expect(screen.getByTestId('favorite-scope-dropdown')).toHaveTextContent('This connection only')
  })

  it('passes changed scope (connectionId) when editing a favorite', async () => {
    const updateFavoriteSpy = vi.fn().mockResolvedValue(true)
    useFavoritesStore.setState({
      editingFavorite: makeFavoriteEntry({ connectionId: 'conn-1' }),
      updateFavorite: updateFavoriteSpy,
    })

    render(<FavoriteDialog connectionId="conn-1" />)

    // Change scope to global
    fireEvent.click(screen.getByTestId('favorite-scope-dropdown'))
    fireEvent.click(screen.getByTestId('favorite-scope-dropdown-option-global'))

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(updateFavoriteSpy).toHaveBeenCalledWith(1, {
        name: 'My Query',
        sqlText: 'SELECT * FROM orders',
        category: 'shopdb',
        description: 'Gets all orders',
        connectionId: null,
      })
    })
  })

  it('shows scope as global when editing a global favorite', () => {
    useFavoritesStore.setState({
      editingFavorite: makeFavoriteEntry({ connectionId: null }),
    })
    render(<FavoriteDialog connectionId="conn-1" />)

    expect(screen.getByTestId('favorite-scope-dropdown')).toHaveTextContent(
      'Global (all connections)'
    )
  })

  it('sends connectionId as null when global scope is selected', async () => {
    const createFavoriteSpy = vi.fn().mockResolvedValue(1)
    useFavoritesStore.setState({ createFavorite: createFavoriteSpy })

    render(<FavoriteDialog connectionId="conn-1" />)

    // Fill required fields
    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Global Fav' },
    })
    fireEvent.change(screen.getByTestId('favorite-sql-input'), {
      target: { value: 'SELECT 1' },
    })

    // Open scope dropdown and select "Global (all connections)"
    fireEvent.click(screen.getByTestId('favorite-scope-dropdown'))
    fireEvent.click(screen.getByTestId('favorite-scope-dropdown-option-global'))

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(createFavoriteSpy).toHaveBeenCalledWith({
        connectionId: null,
        name: 'Global Fav',
        sqlText: 'SELECT 1',
        category: null,
        description: null,
      })
    })
  })

  it('sends connectionId when connection scope is selected (default)', async () => {
    const createFavoriteSpy = vi.fn().mockResolvedValue(1)
    useFavoritesStore.setState({ createFavorite: createFavoriteSpy })

    render(<FavoriteDialog connectionId="conn-1" />)

    fireEvent.change(screen.getByTestId('favorite-name-input'), {
      target: { value: 'Local Fav' },
    })
    fireEvent.change(screen.getByTestId('favorite-sql-input'), {
      target: { value: 'SELECT 1' },
    })

    fireEvent.click(screen.getByTestId('favorite-dialog-save'))

    await waitFor(() => {
      expect(createFavoriteSpy).toHaveBeenCalledWith({
        connectionId: 'conn-1',
        name: 'Local Fav',
        sqlText: 'SELECT 1',
        category: null,
        description: null,
      })
    })
  })

  it('initializes scope as global when editing a global favorite (id=0 save-as flow)', () => {
    useFavoritesStore.setState({
      editingFavorite: {
        id: 0,
        name: '',
        sqlText: 'SELECT 1',
        description: null,
        category: null,
        connectionId: null,
        createdAt: '',
        updatedAt: '',
      },
    })

    render(<FavoriteDialog connectionId="conn-1" />)

    // Scope dropdown should be visible (new mode since id=0)
    expect(screen.getByTestId('favorite-scope-dropdown')).toBeInTheDocument()
    // And should show "Global" because connectionId is null
    expect(screen.getByTestId('favorite-scope-dropdown')).toHaveTextContent(
      'Global (all connections)'
    )
  })
})
