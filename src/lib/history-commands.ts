import type { HistoryPage } from '../types/schema'
import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'

export interface ListHistoryRequest {
  connectionId: string
  page: number
  pageSize: number
  search?: string
  since?: string
}

export interface ListHistoryParams {
  connectionId: string
  page: number
  pageSize: number
  search?: string | null
  since?: string | null
}

function toListHistoryRequest(params: ListHistoryParams): ListHistoryRequest {
  return {
    connectionId: params.connectionId,
    page: params.page,
    pageSize: params.pageSize,
    search: params.search || undefined,
    since: params.since || undefined,
  }
}

export async function listHistory(params: ListHistoryParams): Promise<HistoryPage> {
  return invokeCommand({ command: 'list_history', payload: toListHistoryRequest(params) })
}

export async function deleteHistoryEntry(id: number): Promise<boolean> {
  return invokeArgumentCommand({ command: 'delete_history_entry', argument: { id } })
}

export async function clearHistory(connectionId: string): Promise<number> {
  return invokeArgumentCommand({ command: 'clear_history', argument: { connectionId } })
}
