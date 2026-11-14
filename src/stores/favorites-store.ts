import { create } from 'zustand'
import type { FavoriteEntry, CreateFavoriteInput, UpdateFavoriteInput } from '../types/schema'
import {
  createFavorite as createFavoriteCmd,
  listFavorites as listFavoritesCmd,
  updateFavorite as updateFavoriteCmd,
  deleteFavorite as deleteFavoriteCmd,
} from '../lib/favorites-commands'
import { showErrorToast, showSuccessToast } from './toast-store'

import { logFrontendError } from '../lib/app-log-commands'
import { toErrorMessage } from '../lib/error-message'

interface FavoritesState {
  entries: FavoriteEntry[]
  isLoading: boolean
  error: string | null
  connectionId: string | null

  dialogOpen: boolean
  editingFavorite: FavoriteEntry | null

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

async function loadFavorites(connectionId: string): Promise<void> {
  useFavoritesStore.setState({ isLoading: true, error: null, connectionId: connectionId })

  try {
    const entries = await listFavoritesCmd(connectionId)
    useFavoritesStore.setState({ entries: entries, isLoading: false })
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[favorites-store] loadFavorites failed:', error)
    useFavoritesStore.setState({ isLoading: false, error: message })
  }
}

async function createFavorite(input: CreateFavoriteInput): Promise<number | null> {
  try {
    const id = await createFavoriteCmd(input)
    showSuccessToast('Favorite saved', input.name)
    const { connectionId } = useFavoritesStore.getState()
    if (connectionId) {
      await useFavoritesStore.getState().loadFavorites(connectionId)
    }
    return id
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[favorites-store] createFavorite failed:', error)
    showErrorToast('Failed to save favorite', message)
    return null
  }
}

async function reloadCurrentConnectionFavorites(): Promise<void> {
  const { connectionId } = useFavoritesStore.getState()
  if (!connectionId) return
  await useFavoritesStore.getState().loadFavorites(connectionId)
}

async function updateFavorite(id: number, input: UpdateFavoriteInput): Promise<boolean> {
  try {
    const updated = await updateFavoriteCmd(id, input)
    if (updated) {
      showSuccessToast('Favorite updated', input.name)
      await reloadCurrentConnectionFavorites()
    }
    return updated
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[favorites-store] updateFavorite failed:', error)
    showErrorToast('Failed to update favorite', message)
    return false
  }
}

async function deleteFavorite(id: number): Promise<void> {
  try {
    await deleteFavoriteCmd(id)
    showSuccessToast('Favorite deleted')
    const { connectionId } = useFavoritesStore.getState()
    if (connectionId) {
      await useFavoritesStore.getState().loadFavorites(connectionId)
    }
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontendError('[favorites-store] deleteFavorite failed:', error)
    showErrorToast('Failed to delete favorite', message)
  }
}

function openDialog(favorite?: FavoriteEntry | null): void {
  useFavoritesStore.setState({ dialogOpen: true, editingFavorite: favorite ?? null })
}

function closeDialog(): void {
  useFavoritesStore.setState({ dialogOpen: false, editingFavorite: null })
}

function reset(): void {
  useFavoritesStore.setState(INITIAL_STATE)
}

export const useFavoritesStore = create<FavoritesState>()(() => ({
  ...INITIAL_STATE,
  loadFavorites: loadFavorites,
  createFavorite: createFavorite,
  updateFavorite: updateFavorite,
  deleteFavorite: deleteFavorite,
  openDialog: openDialog,
  closeDialog: closeDialog,
  reset: reset,
}))
