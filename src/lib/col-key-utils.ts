import type { TableDataColumnMeta } from '../types/schema'

export function columnKey(index: number): string {
  return `col_${index}`
}

export function columnIndexFromKey(key: string): number {
  return parseInt(key.replace('col_', ''), 10)
}

export function buildTableColumnLookup(
  editTableColumns: TableDataColumnMeta[]
): Map<string, TableDataColumnMeta> {
  const map = new Map<string, TableDataColumnMeta>()
  for (const tc of editTableColumns) {
    map.set(tc.name.toLowerCase(), tc)
  }
  return map
}
