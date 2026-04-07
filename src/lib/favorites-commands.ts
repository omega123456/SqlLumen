import { invoke } from '@tauri-apps/api/core'
import type { FavoriteEntry, CreateFavoriteInput, UpdateFavoriteInput } from '../types/schema'

export async function createFavorite(input: CreateFavoriteInput): Promise<number> {
  return invoke<number>('create_favorite', { input })
}

export async function listFavorites(connectionId: string): Promise<FavoriteEntry[]> {
  return invoke<FavoriteEntry[]>('list_favorites', { connectionId })
}

export async function updateFavorite(id: number, input: UpdateFavoriteInput): Promise<boolean> {
  return invoke<boolean>('update_favorite', { id, input })
}

export async function deleteFavorite(id: number): Promise<boolean> {
  return invoke<boolean>('delete_favorite', { id })
}
