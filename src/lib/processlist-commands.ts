import { invoke } from '@tauri-apps/api/core'

export interface ProcessRow {
  id: number
  user: string
  host: string
  db: string | null
  command: string
  time: number
  state: string | null
  info: string | null
}

export interface KillResult {
  id: number
  success: boolean
  error: string | null
}

export async function getProcesslist(sessionId: string): Promise<ProcessRow[]> {
  return invoke<ProcessRow[]>('get_processlist', { sessionId })
}

export async function killQueries(sessionId: string, ids: number[]): Promise<KillResult[]> {
  return invoke<KillResult[]>('kill_queries', { sessionId, ids })
}
