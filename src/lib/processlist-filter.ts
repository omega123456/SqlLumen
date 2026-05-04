import type { ProcessRow } from './processlist-commands'

export function isIdleProcessRow(row: ProcessRow): boolean {
  const normalizedState = row.state?.trim().toLowerCase() ?? ''
  const isBlankQuery = row.info == null || row.info.trim().length === 0

  return normalizedState === 'idle' || isBlankQuery
}

export function filterProcessListRows(
  rows: ProcessRow[],
  excludeIdleConnections: boolean
): ProcessRow[] {
  if (!excludeIdleConnections) {
    return rows
  }

  return rows.filter((row) => !isIdleProcessRow(row))
}
