import { invokeCommand } from './ipc/dispatch'

export type LogLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

export interface LogEntry {
  id: number
  timestamp: string
  level: string
  target: string
  message: string
}

export interface LogPage {
  entries: LogEntry[]
  total: number
  page: number
  pageSize: number
}

export async function listLogs(page: number, level: LogLevelFilter): Promise<LogPage> {
  return invokeCommand({ command: 'list_logs', payload: { page, level } })
}

export async function exportLogs(
  startTimestamp: string,
  endTimestamp: string,
  filePath: string
): Promise<number> {
  return invokeCommand({
    command: 'export_logs',
    payload: { startTimestamp, endTimestamp, filePath },
  })
}
