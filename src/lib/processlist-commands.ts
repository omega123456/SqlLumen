import { invokeArgumentCommand, invokeCommand } from './ipc/dispatch'

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
  return invokeArgumentCommand({ command: 'get_processlist', argument: { sessionId } })
}

export async function killQueries(sessionId: string, ids: number[]): Promise<KillResult[]> {
  return invokeCommand({ command: 'kill_queries', payload: { sessionId, ids } })
}
