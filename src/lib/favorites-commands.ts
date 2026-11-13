import type { FavoriteEntry, CreateFavoriteInput, UpdateFavoriteInput } from '../types/schema'
import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'

export async function createFavorite(input: CreateFavoriteInput): Promise<number> {
  return invokeArgumentCommand({ command: 'create_favorite', argument: { input } })
}

export async function listFavorites(connectionId: string): Promise<FavoriteEntry[]> {
  return invokeArgumentCommand({ command: 'list_favorites', argument: { connectionId } })
}

export async function updateFavorite(id: number, input: UpdateFavoriteInput): Promise<boolean> {
  return invokeCommand({ command: 'update_favorite', payload: { id, input } })
}

export async function deleteFavorite(id: number): Promise<boolean> {
  return invokeArgumentCommand({ command: 'delete_favorite', argument: { id } })
}
