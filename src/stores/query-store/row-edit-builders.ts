import type { QueryTableEditInfo } from '../../types/schema'
import { showWarningToast } from '../toast-store'

export function editMetadataWithTable(
  metadata: Record<string, QueryTableEditInfo>,
  tableName: string,
  tableInfo: QueryTableEditInfo
): Record<string, QueryTableEditInfo> {
  if (tableName in metadata) return metadata
  return { ...metadata, [tableName]: tableInfo }
}

interface AmbiguousEditColumnsCheck {
  tableInfo: QueryTableEditInfo
  keyColumns: string[]
  ambiguous: Set<string>
  boundColumnIndexMap: Map<string, number>
}

export function warnAboutAmbiguousEditColumns(check: AmbiguousEditColumnsCheck): void {
  const { tableInfo, keyColumns, ambiguous, boundColumnIndexMap } = check
  if (ambiguous.size === 0) return
  const keyColumnsLower = new Set(keyColumns.map((keyColumn) => keyColumn.toLowerCase()))
  const isUneditableAmbiguousColumn = (columnName: string): boolean => {
    const lower = columnName.toLowerCase()
    if (!ambiguous.has(lower)) return false
    if (keyColumnsLower.has(lower)) return false
    return !boundColumnIndexMap.has(lower)
  }
  const nonKeyAmbiguous = tableInfo.columns
    .map((column) => column.name)
    .filter(isUneditableAmbiguousColumn)
  if (nonKeyAmbiguous.length === 0) return
  showWarningToast(
    'Ambiguous columns',
    `Some columns are ambiguous and cannot be edited: ${nonKeyAmbiguous.join(', ')}`
  )
}
