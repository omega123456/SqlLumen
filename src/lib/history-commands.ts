import { invoke } from '@tauri-apps/api/core'
import type { HistoryPage } from '../types/schema'

export async function listHistory(
  connectionId: string,
  page: number,
  pageSize: number,
  search?: string | null,
  since?: string | null
): Promise<HistoryPage> {
  return invoke<HistoryPage>('list_history', {
    connectionId,
    page,
    pageSize,
    ...(search ? { search } : {}),
    ...(since ? { since } : {}),
  })
}

export async function deleteHistoryEntry(id: number): Promise<boolean> {
  return invoke<boolean>('delete_history_entry', { id })
}

export async function clearHistory(connectionId: string): Promise<number> {
  return invoke<number>('clear_history', { connectionId })
}
