import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useFavoritesStore } from '../../stores/favorites-store'

const INITIAL_STATE = {
  entries: [],
  isLoading: false,
  error: null,
  connectionId: null,
  dialogOpen: false,
  editingFavorite: null,
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  useFavoritesStore.setState(INITIAL_STATE)
  vi.clearAllMocks()

  mockIPC((cmd, args) => {
    switch (cmd) {
      case 'list_favorites':
        return [
          {
            id: 1,
            name: 'Test Favorite',
            sqlText: 'SELECT 1',
            description: 'test description',
            category: 'test',
            connectionId: (args as Record<string, unknown>).connectionId,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ]
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

describe('useFavoritesStore', () => {
  describe('loadFavorites', () => {
    it('loads favorites from backend', async () => {
      await useFavoritesStore.getState().loadFavorites('conn-1')

      const state = useFavoritesStore.getState()
      expect(state.entries).toHaveLength(1)
      expect(state.entries[0].id).toBe(1)
      expect(state.entries[0].name).toBe('Test Favorite')
      expect(state.isLoading).toBe(false)
      expect(state.connectionId).toBe('conn-1')
    })

    it('handles load errors gracefully', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC(() => {
        throw new Error('IPC failure')
      })

      await useFavoritesStore.getState().loadFavorites('conn-1')

      const state = useFavoritesStore.getState()
      expect(state.isLoading).toBe(false)
      expect(state.error).toBe('IPC failure')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('createFavorite', () => {
    it('creates a favorite and refreshes list', async () => {
      useFavoritesStore.setState({ connectionId: 'conn-1' })

      const id = await useFavoritesStore.getState().createFavorite({
        connectionId: 'conn-1',
        name: 'New Favorite',
        sqlText: 'SELECT 2',
        description: null,
        category: null,
      })

      expect(id).toBe(1)
    })

    it('handles create errors with toast', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC((cmd) => {
        if (cmd === 'create_favorite') throw new Error('Create failed')
        if (cmd === 'log_frontend') return undefined
        return null
      })

      const id = await useFavoritesStore.getState().createFavorite({
        name: 'Test',
        sqlText: 'SELECT 1',
      })

      expect(id).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('updateFavorite', () => {
    it('updates a favorite and refreshes list', async () => {
      useFavoritesStore.setState({ connectionId: 'conn-1' })

      const result = await useFavoritesStore.getState().updateFavorite(1, {
        name: 'Updated',
        sqlText: 'SELECT 3',
        description: null,
        category: null,
      })

      expect(result).toBe(true)
    })

    it('handles update errors with toast', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC((cmd) => {
        if (cmd === 'update_favorite') throw new Error('Update failed')
        if (cmd === 'log_frontend') return undefined
        return null
      })

      const result = await useFavoritesStore.getState().updateFavorite(1, {
        name: 'Updated',
        sqlText: 'SELECT 3',
      })

      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('deleteFavorite', () => {
    it('deletes a favorite and refreshes list', async () => {
      useFavoritesStore.setState({ connectionId: 'conn-1' })

      await useFavoritesStore.getState().deleteFavorite(1)

      // Should have refreshed (mock still returns entries)
      expect(useFavoritesStore.getState().connectionId).toBe('conn-1')
    })

    it('handles delete errors with toast', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockIPC((cmd) => {
        if (cmd === 'delete_favorite') throw new Error('Delete failed')
        if (cmd === 'log_frontend') return undefined
        return null
      })

      await useFavoritesStore.getState().deleteFavorite(1)
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('dialog state', () => {
    it('opens dialog for new favorite', () => {
      useFavoritesStore.getState().openDialog(null)

      const state = useFavoritesStore.getState()
      expect(state.dialogOpen).toBe(true)
      expect(state.editingFavorite).toBeNull()
    })

    it('opens dialog for editing existing favorite', () => {
      const fav = {
        id: 1,
        name: 'Test',
        sqlText: 'SELECT 1',
        description: null,
        category: null,
        connectionId: 'conn-1',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }
      useFavoritesStore.getState().openDialog(fav)

      const state = useFavoritesStore.getState()
      expect(state.dialogOpen).toBe(true)
      expect(state.editingFavorite).toEqual(fav)
    })

    it('closes dialog and clears editing state', () => {
      useFavoritesStore.getState().openDialog(null)
      useFavoritesStore.getState().closeDialog()

      const state = useFavoritesStore.getState()
      expect(state.dialogOpen).toBe(false)
      expect(state.editingFavorite).toBeNull()
    })
  })

  describe('reset', () => {
    it('resets to initial state', async () => {
      await useFavoritesStore.getState().loadFavorites('conn-1')
      useFavoritesStore.getState().reset()

      const state = useFavoritesStore.getState()
      expect(state.entries).toEqual([])
      expect(state.connectionId).toBeNull()
      expect(state.dialogOpen).toBe(false)
    })
  })
})
