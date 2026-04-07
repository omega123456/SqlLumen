import { create } from 'zustand'
import type { FavoriteEntry, CreateFavoriteInput, UpdateFavoriteInput } from '../types/schema'
import {
  createFavorite as createFavoriteCmd,
  listFavorites as listFavoritesCmd,
  updateFavorite as updateFavoriteCmd,
  deleteFavorite as deleteFavoriteCmd,
} from '../lib/favorites-commands'
import { showErrorToast, showSuccessToast } from './toast-store'

interface FavoritesState {
  /** Current entries. */
  entries: FavoriteEntry[]
  /** Loading state. */
  isLoading: boolean
  /** Error message. */
  error: string | null
  /** Currently loaded connection ID. */
  connectionId: string | null

  /** Dialog state. */
  dialogOpen: boolean
  /** Favorite being edited (null = creating new). */
  editingFavorite: FavoriteEntry | null

  // Actions
  loadFavorites: (connectionId: string) => Promise<void>
  createFavorite: (input: CreateFavoriteInput) => Promise<number | null>
  updateFavorite: (id: number, input: UpdateFavoriteInput) => Promise<boolean>
  deleteFavorite: (id: number) => Promise<void>
  openDialog: (favorite?: FavoriteEntry | null) => void
  closeDialog: () => void
  reset: () => void
}

const INITIAL_STATE = {
  entries: [] as FavoriteEntry[],
  isLoading: false,
  error: null,
  connectionId: null,
  dialogOpen: false,
  editingFavorite: null,
}

export const useFavoritesStore = create<FavoritesState>()((set, get) => ({
  ...INITIAL_STATE,

  loadFavorites: async (connectionId: string) => {
    set({ isLoading: true, error: null, connectionId })

    try {
      const entries = await listFavoritesCmd(connectionId)
      set({ entries, isLoading: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[favorites-store] loadFavorites failed:', err)
      set({ isLoading: false, error: msg })
    }
  },

  createFavorite: async (input: CreateFavoriteInput) => {
    try {
      const id = await createFavoriteCmd(input)
      showSuccessToast('Favorite saved', input.name)
      // Refresh list
      const { connectionId } = get()
      if (connectionId) {
        await get().loadFavorites(connectionId)
      }
      return id
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[favorites-store] createFavorite failed:', err)
      showErrorToast('Failed to save favorite', msg)
      return null
    }
  },

  updateFavorite: async (id: number, input: UpdateFavoriteInput) => {
    try {
      const updated = await updateFavoriteCmd(id, input)
      if (updated) {
        showSuccessToast('Favorite updated', input.name)
        const { connectionId } = get()
        if (connectionId) {
          await get().loadFavorites(connectionId)
        }
      }
      return updated
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[favorites-store] updateFavorite failed:', err)
      showErrorToast('Failed to update favorite', msg)
      return false
    }
  },

  deleteFavorite: async (id: number) => {
    try {
      await deleteFavoriteCmd(id)
      showSuccessToast('Favorite deleted')
      const { connectionId } = get()
      if (connectionId) {
        await get().loadFavorites(connectionId)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[favorites-store] deleteFavorite failed:', err)
      showErrorToast('Failed to delete favorite', msg)
    }
  },

  openDialog: (favorite?: FavoriteEntry | null) => {
    set({ dialogOpen: true, editingFavorite: favorite ?? null })
  },

  closeDialog: () => {
    set({ dialogOpen: false, editingFavorite: null })
  },

  reset: () => {
    set(INITIAL_STATE)
  },
}))
